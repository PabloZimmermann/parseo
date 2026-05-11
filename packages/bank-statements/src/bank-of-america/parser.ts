import { extractLines, parseCurrency, toBBox, UnrecognizedFormatError } from "@parseo/shared";
import type { TextLine, DateString, BoundingBox } from "@parseo/shared";
import type {
  BankOfAmericaStatement,
  AccountHolder,
  StatementSummary,
  Transaction,
  Check,
  DailyBalance,
} from "./types.js";

export async function parseBankOfAmericaStatement(buffer: Buffer): Promise<BankOfAmericaStatement> {
  const lines = await extractLines(buffer);
  return parseBankOfAmericaFromLines(lines);
}

export function parseBankOfAmericaFromLines(lines: TextLine[]): BankOfAmericaStatement {
  const head = lines.slice(0, 40).map((l) => l.fullText).join("\n");
  if (!/Bank of America/i.test(head) && !/bankofamerica/i.test(head)) {
    throw new UnrecognizedFormatError(
      "BankOfAmerica",
      "first 40 lines do not contain a Bank of America signature"
    );
  }

  const bb: Record<string, BoundingBox> = {};

  const accountHolder = parseAccountHolder(lines);
  const { accountType, bbox: accountTypeBbox } = parseAccountType(lines);
  if (accountTypeBbox) bb.accountType = accountTypeBbox;

  const { statementPeriod, bbox: periodBbox } = parseStatementPeriod(lines);
  if (periodBbox) bb.statementPeriod = periodBbox;

  const { accountNumber, bbox: accountNumberBbox } = parseAccountNumber(lines);
  if (accountNumberBbox) bb.accountNumber = accountNumberBbox;

  const year = statementPeriod.from?.slice(0, 4) ?? "";
  const summary = parseSummary(lines);
  const transactions = parseTransactions(lines, year);
  const checks = parseChecks(lines, year);
  const dailyBalances = parseDailyBalances(lines, year);

  return {
    accountHolder,
    accountNumber,
    accountType,
    statementPeriod,
    summary,
    transactions,
    checks,
    dailyBalances,
    boundingBoxes: bb,
  };
}

// ── Months ─────────────────────────────────────────────────────────────────

const MONTHS: Record<string, string> = {
  January: "01", February: "02", March: "03", April: "04",
  May: "05", June: "06", July: "07", August: "08",
  September: "09", October: "10", November: "11", December: "12",
};

const MONTH_PATTERN = Object.keys(MONTHS).join("|");

// ── Account holder ─────────────────────────────────────────────────────────

function parseAccountHolder(lines: TextLine[]): AccountHolder {
  const bb: Record<string, BoundingBox> = {};
  const parts: { text: string; line: TextLine; seg: import("@parseo/shared").TextSegment }[] = [];

  for (const line of lines) {
    if (line.page !== 1) break;
    if (line.y < 80 || line.y > 250) continue;
    const leftSegs = line.segments.filter((s) => s.x < 200);
    if (leftSegs.length === 0) continue;
    const text = leftSegs.map((s) => s.text).join(" ").trim();
    if (!text) continue;
    // Stop at the account type / statement period lines
    if (/^Your\s/i.test(text) || /^for\s/i.test(text) || /Account\s*number/i.test(text)) break;
    // Skip bank branding / header noise
    if (/Bank of America/i.test(text) || /bankofamerica/i.test(text)) continue;
    parts.push({ text, line, seg: leftSegs[0] });
  }

  const name = parts[0]?.text ?? "";
  if (parts[0]) bb.name = toBBox(parts[0].seg, parts[0].line);

  const addressTexts: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    addressTexts.push(parts[i].text);
    if (i === 1) bb.address = toBBox(parts[i].seg, parts[i].line);
  }

  return { name, address: addressTexts.join(", "), boundingBoxes: bb };
}

// ── Account type ───────────────────────────────────────────────────────────

function parseAccountType(lines: TextLine[]): { accountType: string; bbox: BoundingBox | null } {
  const typeParts: string[] = [];
  let bbox: BoundingBox | null = null;

  for (const line of lines) {
    if (line.page !== 1) break;
    const text = line.fullText.trim();
    if (/^Your\s/i.test(text)) {
      typeParts.push(text.replace(/^Your\s+/i, ""));
      bbox = toBBox(line.segments[0], line);
    } else if (typeParts.length > 0 && /^(Preferred|Rewards|Plus|with)/i.test(text)) {
      typeParts.push(text);
    } else if (typeParts.length > 0) {
      break;
    }
  }

  return { accountType: typeParts.join(" ").trim(), bbox };
}

// ── Statement period ───────────────────────────────────────────────────────

function parseStatementPeriod(lines: TextLine[]): {
  statementPeriod: { from: DateString; to: DateString };
  bbox: BoundingBox | null;
} {
  const rx = new RegExp(
    `for\\s+(${MONTH_PATTERN})\\s+(\\d{1,2}),?\\s+(\\d{4})\\s+to\\s+(${MONTH_PATTERN})\\s+(\\d{1,2}),?\\s+(\\d{4})`,
    "i"
  );

  for (const line of lines) {
    if (line.page !== 1) break;
    const m = line.fullText.match(rx);
    if (m) {
      const from: DateString = `${m[3]}-${MONTHS[m[1]]}-${m[2].padStart(2, "0")}`;
      const to: DateString = `${m[6]}-${MONTHS[m[4]]}-${m[5].padStart(2, "0")}`;
      const seg = line.segments.find((s) => /for\s/i.test(s.text) || new RegExp(MONTH_PATTERN).test(s.text));
      return { statementPeriod: { from, to }, bbox: seg ? toBBox(seg, line) : null };
    }
  }

  return { statementPeriod: { from: null, to: null }, bbox: null };
}

// ── Account number ─────────────────────────────────────────────────────────

function parseAccountNumber(lines: TextLine[]): { accountNumber: string; bbox: BoundingBox | null } {
  for (const line of lines) {
    const m = line.fullText.match(/Account\s*number:\s*([\d\s]+)/);
    if (m) {
      const num = m[1].replace(/\s+/g, "");
      const seg = line.segments.find((s) => /\d{4}/.test(s.text));
      return { accountNumber: num, bbox: seg ? toBBox(seg, line) : null };
    }
  }
  return { accountNumber: "", bbox: null };
}

// ── Summary ────────────────────────────────────────────────────────────────

function parseSummary(lines: TextLine[]): StatementSummary {
  const bb: Record<string, BoundingBox> = {};
  let beginningBalance = 0;
  let totalDeposits = 0;
  let totalWithdrawals = 0;
  let checks = 0;
  let serviceFees = 0;
  let endingBalance = 0;

  for (const line of lines) {
    if (line.page > 2) break;
    const text = line.fullText;

    if (/Beginning balance on/i.test(text)) {
      const { value, bbox: vb } = parseAmountFromLine(line, 250);
      beginningBalance = value ?? 0;
      if (vb) bb.beginningBalance = vb;
    } else if (/Deposits and other credits/i.test(text) && !/^Date/i.test(text)) {
      // Summary line, not section header (section header has no amount)
      const { value, bbox: vb } = parseAmountFromLine(line, 250);
      if (value !== null) {
        totalDeposits = value;
        if (vb) bb.totalDeposits = vb;
      }
    } else if (/Withdrawals and other debits/i.test(text)) {
      const { value, bbox: vb } = parseAmountFromLine(line, 250);
      totalWithdrawals = Math.abs(value ?? 0);
      if (vb) bb.totalWithdrawals = vb;
    } else if (/^Checks\b/i.test(text)) {
      const { value, bbox: vb } = parseAmountFromLine(line, 250);
      if (value !== null) {
        checks = Math.abs(value);
        if (vb) bb.checks = vb;
      }
    } else if (/Service fees/i.test(text)) {
      const { value, bbox: vb } = parseAmountFromLine(line, 250);
      serviceFees = Math.abs(value ?? 0);
      if (vb) bb.serviceFees = vb;
    } else if (/Ending balance on/i.test(text)) {
      const { value, bbox: vb } = parseAmountFromLine(line, 250);
      endingBalance = value ?? 0;
      if (vb) bb.endingBalance = vb;
    }
  }

  return {
    beginningBalance,
    totalDeposits,
    totalWithdrawals,
    checks,
    serviceFees,
    endingBalance,
    boundingBoxes: bb,
  };
}

function parseAmountFromLine(line: TextLine, minX: number): { value: number | null; bbox: BoundingBox | null } {
  // Take the last segment that looks like a currency value past minX
  let result: { value: number | null; bbox: BoundingBox | null } = { value: null, bbox: null };
  for (const seg of line.segments) {
    if (seg.x >= minX) {
      const val = parseCurrency(seg.text.replace(/^-\s*/, "-"));
      if (val !== null) {
        result = { value: val, bbox: toBBox(seg, line) };
      }
    }
  }
  return result;
}

// ── Date helpers ───────────────────────────────────────────────────────────

function shortDateToISO(dateStr: string, year: string): DateString {
  // MM/DD/YY format
  const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (m) {
    const yy = parseInt(m[3], 10);
    const fullYear = yy >= 80 ? `19${m[3]}` : `20${m[3]}`;
    return `${fullYear}-${m[1]}-${m[2]}`;
  }
  // MM/DD format
  const m2 = dateStr.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m2) {
    return `${year}-${m2[1].padStart(2, "0")}-${m2[2].padStart(2, "0")}`;
  }
  return null;
}

// ── Transactions (Deposits + Withdrawals) ──────────────────────────────────

const AMOUNT_MIN_X = 480;

function parseTransactions(lines: TextLine[], year: string): Transaction[] {
  const transactions: Transaction[] = [];
  let category = "";
  let inSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = line.fullText.trim();

    // Section headers
    if (/^Deposits and other credits\s*$/i.test(text)) {
      category = "Deposits and other credits";
      inSection = true;
      continue;
    }
    if (/^Withdrawals and other debits\s*$/i.test(text)) {
      category = "Withdrawals and other debits";
      inSection = true;
      continue;
    }

    // End of transaction sections
    if (inSection && /^(Checks\s*$|Daily ledger balance|Total\s|Service fees|Ending balance)/i.test(text)) {
      inSection = false;
      continue;
    }

    if (!inSection) continue;

    // Skip sub-headers (Date | Description | Amount columns)
    if (/^Date\s+Description/i.test(text)) continue;
    // Skip total lines
    if (/^Total\s/i.test(text)) continue;

    // Transaction line: starts with MM/DD/YY
    const firstSeg = line.segments[0];
    if (!firstSeg) continue;
    const dateMatch = firstSeg.text.trim().match(/^(\d{2}\/\d{2}\/\d{2})$/);
    if (!dateMatch) {
      // Continuation line — append to last transaction
      if (transactions.length > 0) {
        const descParts = line.segments
          .filter((s) => s.x < AMOUNT_MIN_X)
          .map((s) => s.text.trim())
          .filter(Boolean);
        if (descParts.length > 0) {
          transactions[transactions.length - 1].description += " " + descParts.join(" ");
        }
      }
      continue;
    }

    const bb: Record<string, BoundingBox> = {};
    const date = shortDateToISO(dateMatch[1], year);
    bb.date = toBBox(firstSeg, line);

    // Description: segments between date and amount
    const descSegs = line.segments.filter((s) => s.x > firstSeg.x + firstSeg.width && s.x < AMOUNT_MIN_X);
    const description = descSegs.map((s) => s.text.trim()).join(" ");
    if (descSegs.length > 0) bb.description = toBBox(descSegs[0], line);

    // Amount: rightmost segment
    const amountSegs = line.segments.filter((s) => s.x >= AMOUNT_MIN_X);
    let amount = 0;
    if (amountSegs.length > 0) {
      const amtSeg = amountSegs[amountSegs.length - 1];
      amount = parseCurrency(amtSeg.text) ?? 0;
      bb.amount = toBBox(amtSeg, line);
    }

    transactions.push({ date, description, amount, category, boundingBoxes: bb });
  }

  return transactions;
}

// ── Checks ─────────────────────────────────────────────────────────────────

function parseChecks(lines: TextLine[], year: string): Check[] {
  const checks: Check[] = [];
  let inSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = line.fullText.trim();

    if (/^Checks\s*$/i.test(text)) {
      inSection = true;
      continue;
    }

    if (inSection && /^(Daily ledger balance|Service fees|Ending balance|Total\s)/i.test(text)) {
      inSection = false;
      continue;
    }

    if (!inSection) continue;
    if (/^Date\s/i.test(text) || /^Number\s/i.test(text)) continue;
    if (/^Total\s/i.test(text)) continue;

    const firstSeg = line.segments[0];
    if (!firstSeg) continue;
    const dateMatch = firstSeg.text.trim().match(/^(\d{2}\/\d{2}\/\d{2})$/);
    if (!dateMatch) continue;

    const bb: Record<string, BoundingBox> = {};
    const date = shortDateToISO(dateMatch[1], year);
    bb.date = toBBox(firstSeg, line);

    // Check number is second segment
    let checkNumber = "";
    if (line.segments.length > 1) {
      const numSeg = line.segments[1];
      checkNumber = numSeg.text.trim().replace(/^\*?\s*/, "");
      bb.checkNumber = toBBox(numSeg, line);
    }

    // Amount: last numeric segment
    let amount = 0;
    for (let s = line.segments.length - 1; s >= 0; s--) {
      const val = parseCurrency(line.segments[s].text);
      if (val !== null) {
        amount = val;
        bb.amount = toBBox(line.segments[s], line);
        break;
      }
    }

    checks.push({ date, checkNumber, amount, boundingBoxes: bb });
  }

  return checks;
}

// ── Daily ledger balances ──────────────────────────────────────────────────

function parseDailyBalances(lines: TextLine[], year: string): DailyBalance[] {
  const balances: DailyBalance[] = [];
  let inSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = line.fullText.trim();

    if (/^Daily ledger balance/i.test(text)) {
      inSection = true;
      continue;
    }

    if (inSection && /^(Service fees|Ending balance|Total\s|The information)/i.test(text)) {
      break;
    }

    if (!inSection) continue;
    if (/^Date\s+Balance/i.test(text)) continue;

    // Multi-column layout: date/balance pairs repeat across the line
    const segs = line.segments;
    for (let s = 0; s < segs.length; s++) {
      const dateM = segs[s].text.trim().match(/^(\d{2}\/\d{2}\/\d{2})$/);
      if (dateM && s + 1 < segs.length) {
        const date = shortDateToISO(dateM[1], year);
        const val = parseCurrency(segs[s + 1].text);
        if (date && val !== null) {
          balances.push({ date, balance: val });
          s++; // skip the balance segment
        }
      }
    }
  }

  return balances;
}
