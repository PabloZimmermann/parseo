import { extractLines, toBBox, UnrecognizedFormatError } from "@parseo/shared";
import type { TextLine, TextSegment, DateString, BoundingBox } from "@parseo/shared";
import type {
  SpaceCoastStatement,
  AccountHolder,
  Account,
  AccountSummary,
  Transaction,
  ClearedCheck,
} from "./types.js";

const BANK_NAME = "Space Coast Credit Union";
const ENTITY_RE =
  /\b(LLC|L\.L\.C|INC|INCORPORATED|CORP|CORPORATION|COMPANY|LP|LLP|LTD|PLLC|PC|PA|TRUST|FOUNDATION|ASSOCIATION|PARTNERS|ENTERPRISES|HOLDINGS|GROUP|SERVICES|SOLUTIONS|INDUSTRIES|VENTURES|CAPITAL)\b/i;
const AMOUNT_RE = /^-?\$?[\d,]+\.\d{2}$/;
const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;
const GAP = 9;

export async function parseSpaceCoastStatement(buffer: Buffer): Promise<SpaceCoastStatement> {
  const lines = await extractLines(buffer);
  return parseSpaceCoastFromLines(lines);
}

export function parseSpaceCoastFromLines(lines: TextLine[]): SpaceCoastStatement {
  const head = lines.slice(0, 30).map((l) => l.fullText).join("\n");
  if (!/SCCU/i.test(head) && !/Space\s*Coast/i.test(head)) {
    throw new UnrecognizedFormatError(
      "SpaceCoast",
      "first 30 lines do not contain a SCCU / Space Coast signature"
    );
  }

  const bb: Record<string, BoundingBox> = {};
  const accountHolder = parseAccountHolder(lines);
  const { period, memberNumber, bbox } = parseStatementMeta(lines);
  if (bbox) bb.statementPeriod = bbox;

  const accounts = parseAccounts(lines);

  return {
    bankName: BANK_NAME,
    accountHolder,
    memberNumber,
    statementPeriod: period,
    documentDate: period.to,
    accounts,
    boundingBoxes: bb,
  };
}

// ── helpers ───────────────────────────────────────────────────────────────

function num(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return parseFloat(cleaned);
}

function toISO(mm: string, dd: string, yy: string): DateString {
  const year = yy.length <= 2 ? 2000 + parseInt(yy, 10) : parseInt(yy, 10);
  return `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function classifyHolder(name: string): "entity" | "individual" {
  return ENTITY_RE.test(name) ? "entity" : "individual";
}

// ── account holder ──────────────────────────────────────────────────────

function parseAccountHolder(lines: TextLine[]): AccountHolder {
  const bb: Record<string, BoundingBox> = {};
  const block = lines.filter(
    (l) =>
      l.page === 1 &&
      l.y > 165 &&
      l.y < 215 &&
      l.segments[0] &&
      l.segments[0].x > 85 &&
      l.segments[0].x < 130
  );
  block.sort((a, b) => a.y - b.y);

  let name = "";
  const addressParts: string[] = [];
  for (const line of block) {
    const text = line.fullText.trim();
    if (!text) continue;
    if (!name) {
      name = text;
      bb.name = toBBox(line.segments[0], line);
    } else {
      addressParts.push(text);
      if (!bb.address) bb.address = toBBox(line.segments[0], line);
    }
  }

  return { name, type: classifyHolder(name), address: addressParts.join(", "), boundingBoxes: bb };
}

// ── statement period + member number ──────────────────────────────────────

function parseStatementMeta(lines: TextLine[]): {
  period: { from: DateString; to: DateString };
  memberNumber: string;
  bbox: BoundingBox | null;
} {
  for (const line of lines.slice(0, 40)) {
    const m = line.fullText.match(
      /(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+to\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/
    );
    if (!m) continue;
    const memberSeg = line.segments.find((s) => /^\d{6,}$/.test(s.text.trim()));
    const periodSeg = line.segments.find((s) => /\d+\/\d+\/\d+\s+to/.test(s.text));
    return {
      period: { from: toISO(m[1], m[2], m[3]), to: toISO(m[4], m[5], m[6]) },
      memberNumber: memberSeg ? memberSeg.text.trim() : "",
      bbox: periodSeg ? toBBox(periodSeg, line) : null,
    };
  }
  return { period: { from: null, to: null }, memberNumber: "", bbox: null };
}

// ── accounts ──────────────────────────────────────────────────────────────

function isAccountHeader(text: string): string | null {
  const m = text.match(/^(.+?)\s+Account Summary$/i);
  if (!m) return null;
  if (/^Statement/i.test(m[1])) return null;
  return m[1].trim();
}

function parseAccounts(lines: TextLine[]): Account[] {
  const starts: { idx: number; type: string }[] = [];
  lines.forEach((line, idx) => {
    const type = isAccountHeader(line.fullText.trim());
    if (type) starts.push({ idx, type });
  });

  const accounts: Account[] = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i].idx;
    const end = i + 1 < starts.length ? starts[i + 1].idx : lines.length;
    const block = lines.slice(start, end);
    accounts.push(parseAccount(block, starts[i].type));
  }
  return accounts;
}

function parseAccount(block: TextLine[], accountType: string): Account {
  const bb: Record<string, BoundingBox> = {};

  let accountNumber = "";
  for (const line of block) {
    const m = line.fullText.match(/Account Number\s+(\d+)/i);
    if (m) {
      accountNumber = m[1];
      const seg = line.segments.find((s) => s.text.includes(m[1]));
      if (seg) bb.accountNumber = toBBox(seg, line);
      break;
    }
  }

  const actIdx = block.findIndex((l) => /^Account Activity$/i.test(l.fullText.trim()));
  const summaryLines = block.slice(0, actIdx >= 0 ? actIdx : block.length);
  const summary = parseSummary(summaryLines);
  if (summary.boundingBoxes.endingBalance) bb.endingBalance = summary.boundingBoxes.endingBalance;

  const activityLines: TextLine[] = [];
  if (actIdx >= 0) {
    for (let i = actIdx + 1; i < block.length; i++) {
      const t = block[i].fullText.trim();
      if (/^Summary of Checks Cleared/i.test(t)) break;
      if (/^Overdraft and Returned Item Fees/i.test(t)) break;
      if (isAccountHeader(t)) break;
      activityLines.push(block[i]);
    }
  }
  const transactions = parseTransactions(activityLines);

  const { checks, total } = parseChecksCleared(block);

  return {
    accountType,
    accountNumber,
    summary,
    transactions,
    checksCleared: checks,
    totalChecksPaid: total,
    boundingBoxes: bb,
  };
}

// ── account summary ─────────────────────────────────────────────────────

function findCurrency(lines: TextLine[], label: RegExp): { value: number; bbox: BoundingBox | null } | null {
  for (const line of lines) {
    const m = line.fullText.match(label);
    if (!m) continue;
    const value = num(m[1]);
    if (value === null) continue;
    const seg = line.segments.find((s) => s.text.replace(/[$,]/g, "").includes(m[1].replace(/,/g, "")));
    return { value, bbox: seg ? toBBox(seg, line) : null };
  }
  return null;
}

function parseSummary(lines: TextLine[]): AccountSummary {
  const bb: Record<string, BoundingBox> = {};

  const beginning = findCurrency(lines, /Beginning Balance\s+\$?([\d,]+\.\d{2})/i);
  const ending = findCurrency(lines, /Ending Balance\s+\$?([\d,]+\.\d{2})/i);
  const moneyIn = findCurrency(lines, /Total Money In\s+\$?([\d,]+\.\d{2})/i);
  const moneyOut = findCurrency(lines, /Total Money Out\s+\$?([\d,]+\.\d{2})/i);
  const charges = findCurrency(lines, /Total Service Charges\s+\$?([\d,]+\.\d{2})/i);

  let daysInPeriod = 0;
  for (const line of lines) {
    const m = line.fullText.match(/Days In Period\s+(\d+)/i);
    if (m) {
      daysInPeriod = parseInt(m[1], 10);
      break;
    }
  }

  if (beginning?.bbox) bb.beginningBalance = beginning.bbox;
  if (ending?.bbox) bb.endingBalance = ending.bbox;

  return {
    beginningBalance: beginning?.value ?? 0,
    endingBalance: ending?.value ?? 0,
    totalDepositsAndAdditions: moneyIn?.value ?? 0,
    totalMoneyOut: moneyOut?.value ?? 0,
    totalServiceCharges: charges?.value ?? 0,
    daysInPeriod,
    boundingBoxes: bb,
  };
}

// ── transactions ──────────────────────────────────────────────────────────

const SKIP_RE = [
  /Page \d+ of \d+/i,
  /Continued to next page/i,
  /SCCU Routing Number/i,
  /Account \(continued\)/i,
  /^Transaction\s+Effective$/i,
  /Transaction Description/i,
  /^\d-\d{3}-\d{5}-/,
  /SCCU\.com/i,
  /^Beginning Balance/i,
  /^Ending Balance/i,
];

function isSkip(line: TextLine): boolean {
  const t = line.fullText.trim();
  if (!t) return true;
  return SKIP_RE.some((re) => re.test(t));
}

function isAnchor(line: TextLine): boolean {
  const first = line.segments[0];
  return !!first && DATE_RE.test(first.text.trim());
}

function parseTransactions(activityLines: TextLine[]): Transaction[] {
  const content = activityLines.filter((l) => !isSkip(l));

  // Cluster content lines: a new cluster starts on page change or a y-gap > GAP.
  const clusters: TextLine[][] = [];
  let current: TextLine[] = [];
  for (const line of content) {
    const prev = current[current.length - 1];
    if (prev && (prev.page !== line.page || line.y - prev.y > GAP)) {
      clusters.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length) clusters.push(current);

  const transactions: Transaction[] = [];
  for (const cluster of clusters) {
    const anchors = cluster.filter(isAnchor);
    if (anchors.length === 0) continue;

    for (const anchor of anchors) {
      // Attach each non-anchor line in the cluster to its nearest anchor.
      const own = cluster.filter(
        (l) =>
          !isAnchor(l) &&
          anchors.every((a) => Math.abs(l.y - anchor.y) <= Math.abs(l.y - a.y))
      );
      transactions.push(buildTransaction(anchor, own));
    }
  }

  return transactions;
}

function buildTransaction(anchor: TextLine, fragments: TextLine[]): Transaction {
  const bb: Record<string, BoundingBox> = {};

  // Date segments are the leading m/d/yy values.
  const dateSegs = anchor.segments.filter((s) => /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(s.text.trim()));
  const dm = anchor.segments[0].text.trim().match(DATE_RE);
  const date = dm ? toISO(dm[1], dm[2], dm[3]) : null;
  if (dm) bb.date = toBBox(anchor.segments[0], anchor);

  let effectiveDate: DateString = date;
  if (dateSegs[1]) {
    const em = dateSegs[1].text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (em) effectiveDate = toISO(em[1], em[2], em[3]);
  }

  // Numeric (amount / balance) segments, ordered left → right.
  const numSegs = anchor.segments
    .filter((s) => AMOUNT_RE.test(s.text.trim()))
    .sort((a, b) => a.x - b.x);

  let amount = 0;
  let balance: number | null = null;
  if (numSegs.length >= 2) {
    const balSeg = numSegs[numSegs.length - 1];
    const amtSeg = numSegs[numSegs.length - 2];
    balance = num(balSeg.text);
    amount = num(amtSeg.text) ?? 0;
    bb.amount = toBBox(amtSeg, anchor);
    bb.balance = toBBox(balSeg, anchor);
  } else if (numSegs.length === 1) {
    amount = num(numSegs[0].text) ?? 0;
    bb.amount = toBBox(numSegs[0], anchor);
  }

  // Inline description on the anchor line (e.g. "Check 2582", "Deposit").
  let inline = "";
  for (const s of anchor.segments) {
    if (numSegs.includes(s)) continue;
    let t = s.text.trim();
    const dmatch = t.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}\s*(.*)$/);
    if (dmatch) t = dmatch[1].trim();
    if (t) inline += (inline ? " " : "") + t;
  }

  const leading = fragments.filter((f) => f.y < anchor.y).sort((a, b) => a.y - b.y);
  const trailing = fragments.filter((f) => f.y > anchor.y).sort((a, b) => a.y - b.y);
  const description = [
    ...leading.map((l) => l.fullText.trim()),
    inline,
    ...trailing.map((l) => l.fullText.trim()),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    date,
    effectiveDate,
    description,
    amount,
    type: amount < 0 ? "withdrawal" : "deposit",
    balance,
    boundingBoxes: bb,
  };
}

// ── checks cleared ─────────────────────────────────────────────────────────

function parseChecksCleared(block: TextLine[]): { checks: ClearedCheck[]; total: number } {
  const startIdx = block.findIndex((l) => /^Summary of Checks Cleared/i.test(l.fullText.trim()));
  if (startIdx < 0) return { checks: [], total: 0 };

  const checks: ClearedCheck[] = [];
  let total = 0;
  for (let i = startIdx + 1; i < block.length; i++) {
    const t = block[i].fullText.trim();
    if (/^\*Next to number/i.test(t)) break;
    if (/^Overdraft and Returned Item Fees/i.test(t)) break;
    if (isAccountHeader(t)) break;
    if (/Check No\.\s+Amount/i.test(t)) continue;

    const re = /(\d+)\s+([\d,]+\.\d{2})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      const amount = num(m[2]);
      if (amount === null) continue;
      checks.push({ checkNumber: m[1], amount, boundingBoxes: {} });
      total += amount;
    }
  }

  return { checks, total: Math.round(total * 100) / 100 };
}
