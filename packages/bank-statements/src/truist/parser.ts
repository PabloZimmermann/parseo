import { extractLines, parseCurrency, toBBox, UnrecognizedFormatError } from "@parseo/shared";
import type { TextLine, DateString, BoundingBox } from "@parseo/shared";
import type {
  TruistStatement,
  AccountHolder,
  AccountSummary,
  Check,
  Transaction,
} from "./types.js";

export async function parseTruistStatement(buffer: Buffer): Promise<TruistStatement> {
  const lines = await extractLines(buffer);
  return parseTruistFromLines(lines);
}

export function parseTruistFromLines(lines: TextLine[]): TruistStatement {
  const head = lines.slice(0, 30).map((l) => l.fullText).join("\n");
  if (!/truist/i.test(head) && !/4TRUIST/i.test(head)) {
    throw new UnrecognizedFormatError(
      "Truist",
      "first 30 lines do not contain a Truist signature"
    );
  }

  const bb: Record<string, BoundingBox> = {};

  const accountHolder = parseAccountHolder(lines);
  const { accountNumber, accountType } = parseAccountInfo(lines);
  const summary = parseAccountSummary(lines);
  const statementPeriod = parseStatementPeriod(lines);
  const year = parseInt(statementPeriod.end?.slice(0, 4) ?? "2025", 10);
  const checks = parseChecks(lines, year);
  const withdrawals = parseWithdrawals(lines, year);
  const deposits = parseDeposits(lines, year);

  const transactions = [...withdrawals, ...deposits];
  const totalDeposits = summary.totalDepositsCredits;
  const totalWithdrawals = summary.totalChecks + summary.totalOtherWithdrawals;

  return {
    accountHolder,
    accountNumber,
    accountType,
    statementPeriod,
    summary,
    checks,
    transactions,
    totalDeposits,
    totalWithdrawals,
    boundingBoxes: bb,
  };
}

// ── Account holder ────────────────────────────────────────────────────────

function parseAccountHolder(lines: TextLine[]): AccountHolder {
  const bb: Record<string, BoundingBox> = {};
  const page1 = lines.filter((l) => l.page === 1);

  // Name and address at x≈85, y between 100-140
  let name = "";
  const addressParts: string[] = [];

  for (const line of page1) {
    if (line.y < 100 || line.y > 145) continue;
    const segs = line.segments.filter((s) => s.x >= 80 && s.x < 250);
    if (segs.length === 0) continue;
    const text = segs.map((s) => s.text).join(" ").trim();
    if (!text || /^\d{3}-\d{2}/.test(text)) continue; // skip routing number line

    if (!name) {
      name = text;
      bb.name = toBBox(segs[0], line);
    } else {
      addressParts.push(text);
      if (!bb.address) bb.address = toBBox(segs[0], line);
    }
  }

  return { name, address: addressParts.join(", "), boundingBoxes: bb };
}

// ── Account info ──────────────────────────────────────────────────────────

function parseAccountInfo(lines: TextLine[]): { accountNumber: string; accountType: string } {
  for (const line of lines) {
    // "¡ TRUIST SIMPLE BUSINESS CHECKING 1100009275965"
    const m = line.fullText.match(/TRUIST\s+(.+?)\s+(\d{10,})/i);
    if (m) {
      return { accountType: m[1].trim(), accountNumber: m[2] };
    }
  }
  return { accountNumber: "", accountType: "" };
}

// ── Statement period ──────────────────────────────────────────────────────

function parseStatementPeriod(lines: TextLine[]): { start: DateString; end: DateString } {
  let start: DateString = null;
  let end: DateString = null;

  for (const line of lines) {
    const prevMatch = line.fullText.match(/previous balance as of\s+(\d{2})\/(\d{2})\/(\d{4})/i);
    if (prevMatch) {
      // Statement starts the day after previous balance date
      const prevDate = new Date(
        parseInt(prevMatch[3], 10),
        parseInt(prevMatch[1], 10) - 1,
        parseInt(prevMatch[2], 10)
      );
      prevDate.setDate(prevDate.getDate() + 1);
      const mm = String(prevDate.getMonth() + 1).padStart(2, "0");
      const dd = String(prevDate.getDate()).padStart(2, "0");
      start = `${prevDate.getFullYear()}-${mm}-${dd}`;
    }

    const newMatch = line.fullText.match(/new balance as of\s+(\d{2})\/(\d{2})\/(\d{4})/i);
    if (newMatch) {
      end = `${newMatch[3]}-${newMatch[1]}-${newMatch[2]}`;
    }
  }

  return { start, end };
}

// ── Account summary ───────────────────────────────────────────────────────

/** Strip leading "+", "-", "=", "$" from summary amounts like "- 31,326.83" or "= $91,636.01" */
function parseSummaryAmt(text: string): number {
  const clean = text.replace(/^[=+-]\s*/, "").replace(/^\$\s*/, "");
  return parseCurrency(clean) ?? 0;
}

function parseAccountSummary(lines: TextLine[]): AccountSummary {
  const bb: Record<string, BoundingBox> = {};
  let previousBalance = 0;
  let totalChecks = 0;
  let totalOtherWithdrawals = 0;
  let totalDepositsCredits = 0;
  let newBalance = 0;

  for (const line of lines) {
    if (line.page !== 1) continue;
    if (line.y < 340 || line.y > 420) continue; // summary region only

    const firstSeg = line.segments[0];
    if (!firstSeg || firstSeg.x > 50) continue;
    const label = firstSeg.text.trim();

    const valSeg = line.segments.find((s) => s.x > 200);
    if (!valSeg) continue;

    if (/previous balance/i.test(label)) {
      previousBalance = parseSummaryAmt(valSeg.text);
      bb.previousBalance = toBBox(valSeg, line);
    } else if (/^Checks$/i.test(label)) {
      totalChecks = parseSummaryAmt(valSeg.text);
      bb.totalChecks = toBBox(valSeg, line);
    } else if (/^Other withdrawals/i.test(label)) {
      totalOtherWithdrawals = parseSummaryAmt(valSeg.text);
      bb.totalOtherWithdrawals = toBBox(valSeg, line);
    } else if (/^Deposits, credits/i.test(label)) {
      totalDepositsCredits = parseSummaryAmt(valSeg.text);
      bb.totalDepositsCredits = toBBox(valSeg, line);
    } else if (/new balance/i.test(label)) {
      newBalance = parseSummaryAmt(valSeg.text);
      bb.newBalance = toBBox(valSeg, line);
    }
  }

  return { previousBalance, totalChecks, totalOtherWithdrawals, totalDepositsCredits, newBalance, boundingBoxes: bb };
}

// ── Checks ────────────────────────────────────────────────────────────────

// 3-column layout for checks
const CHECK_COLS = [
  { dateX: 0, numX: 60, amtX: 130, maxX: 210 },
  { dateX: 210, numX: 250, amtX: 330, maxX: 410 },
  { dateX: 410, numX: 445, amtX: 520, maxX: 600 },
];

function parseChecks(lines: TextLine[], year: number): Check[] {
  const checks: Check[] = [];

  // Find check section: starts at "Checks" header, ends at "Other withdrawals"
  let inChecks = false;

  for (const line of lines) {
    if (line.page !== 1) continue;
    const text = line.fullText.trim();

    if (/^Checks$/i.test(text) && line.y > 420) {
      inChecks = true;
      continue;
    }
    if (/\*.*indicates a skip/i.test(text)) continue;
    if (/^Total checks/i.test(text)) { inChecks = false; continue; }
    if (/Other withdrawals/i.test(text) && line.y > 500) { inChecks = false; continue; }

    if (!inChecks) continue;

    // Skip column headers
    if (/^DATE/.test(text)) continue;

    // Parse each of the 3 columns
    for (const col of CHECK_COLS) {
      const dateSeg = line.segments.find(
        (s) => s.x >= col.dateX && s.x < col.numX && /^\d{2}\/\d{2}$/.test(s.text.trim())
      );
      if (!dateSeg) continue;

      const numSeg = line.segments.find(
        (s) => s.x >= col.numX && s.x < col.amtX
      );
      const amtSeg = line.segments.find(
        (s) => s.x >= col.amtX && s.x < col.maxX && /[\d,.]+/.test(s.text)
      );
      if (!amtSeg) continue;

      const txBb: Record<string, BoundingBox> = {};
      const dm = dateSeg.text.trim().match(/^(\d{2})\/(\d{2})$/);
      if (!dm) continue;

      const date: DateString = `${year}-${dm[1]}-${dm[2]}`;
      txBb.date = toBBox(dateSeg, line);

      const checkNumber = (numSeg?.text ?? "").replace(/^\*/, "").trim();
      if (numSeg) txBb.checkNumber = toBBox(numSeg, line);

      const amount = parseCurrency(amtSeg.text) ?? 0;
      txBb.amount = toBBox(amtSeg, line);

      checks.push({ date, checkNumber, amount, boundingBoxes: txBb });
    }
  }

  return checks;
}

// ── Withdrawals ───────────────────────────────────────────────────────────

function parseWithdrawals(lines: TextLine[], year: number): Transaction[] {
  return parseSectionTransactions(lines, year, "withdrawal");
}

// ── Deposits ──────────────────────────────────────────────────────────────

function parseDeposits(lines: TextLine[], year: number): Transaction[] {
  return parseSectionTransactions(lines, year, "deposit");
}

// ── Shared transaction parser for withdrawals/deposits sections ──────────

function parseSectionTransactions(
  lines: TextLine[],
  year: number,
  type: "deposit" | "withdrawal",
): Transaction[] {
  const transactions: Transaction[] = [];
  const sectionHeader = type === "withdrawal"
    ? /Other withdrawals, debits and service charges/i
    : /Deposits, credits and interest/i;
  const sectionTotal = type === "withdrawal"
    ? /Total other withdrawals/i
    : /Total deposits, credits/i;

  let inSection = false;

  for (const line of lines) {
    const text = line.fullText.trim();

    // Section start — skip the summary line on page 1 (it has an amount value segment)
    if (sectionHeader.test(text)) {
      const isHeaderOnly = !line.segments.some((s) => s.x > 200 && /[\d$]/.test(s.text));
      if (isHeaderOnly) {
        inSection = true;
        continue;
      }
    }

    // Continuation header on subsequent pages
    if (inSection && /\(continued\)/i.test(text)) continue;

    // Section end
    if (inSection && sectionTotal.test(text)) {
      inSection = false;
      continue;
    }

    // Different section starts → end current
    if (inSection) {
      if (type === "withdrawal" && /^Deposits, credits/i.test(text)) {
        inSection = false;
        continue;
      }
    }

    if (!inSection) continue;

    // Skip column headers and continued markers
    if (/^DATE\s+DESCRIPTION/i.test(text)) continue;
    if (/^continued$/i.test(text)) continue;
    if (/^§ PAGE/i.test(text)) continue;

    // Parse transaction: date at x≈27, description at x≈66.6, amount at x>500
    const dateSeg = line.segments.find(
      (s) => s.x < 50 && /^\d{2}\/\d{2}$/.test(s.text.trim())
    );
    if (!dateSeg) continue;

    const txBb: Record<string, BoundingBox> = {};
    const dm = dateSeg.text.trim().match(/^(\d{2})\/(\d{2})$/);
    if (!dm) continue;

    const date: DateString = `${year}-${dm[1]}-${dm[2]}`;
    txBb.date = toBBox(dateSeg, line);

    // Description: all segments between date and amount (x > 50 and x < 500)
    const descSegs = line.segments.filter((s) => s.x > 50 && s.x < 500);
    const description = descSegs.map((s) => s.text).join(" ").trim();
    if (descSegs.length > 0) txBb.description = toBBox(descSegs[0], line);

    // Amount: rightmost segment (x >= 500)
    const amtSeg = line.segments.find((s) => s.x >= 500 && /[\d,.]+/.test(s.text));
    if (!amtSeg) continue;

    const amount = parseCurrency(amtSeg.text) ?? 0;
    txBb.amount = toBBox(amtSeg, line);

    transactions.push({
      date,
      description,
      amount: type === "withdrawal" ? -amount : amount,
      type,
      boundingBoxes: txBb,
    });
  }

  return transactions;
}
