import { extractLines, parseCurrency, parseNum, toBBox, UnrecognizedFormatError, MissingSectionError } from "@parseo/shared";
import type { TextLine, DateString, BoundingBox } from "@parseo/shared";
import type { TDBankStatement, AccountHolder, StatementSummary, Transaction } from "./types.js";

export async function parseTDBankStatement(buffer: Buffer): Promise<TDBankStatement> {
  const lines = await extractLines(buffer);
  return parseTDBankFromLines(lines);
}

export function parseTDBankFromLines(lines: TextLine[]): TDBankStatement {
  const head = lines.slice(0, 20).map((l) => l.fullText).join("\n");
  if (!/TD\s*Bank/i.test(head) && !/tdbank\.com/i.test(head) && !/STATEMENT OF ACCOUNT/i.test(head)) {
    throw new UnrecognizedFormatError(
      "TDBank",
      "first 20 lines do not contain a TD Bank signature"
    );
  }

  const bb: Record<string, BoundingBox> = {};

  const { accountType, bbox: accountTypeBbox } = parseAccountType(lines);
  if (accountTypeBbox) bb.accountType = accountTypeBbox;

  const accountHolder = parseAccountHolder(lines);

  const { accountNumber, bbox: accountNumberBbox } = parseAccountNumber(lines);
  if (accountNumberBbox) bb.accountNumber = accountNumberBbox;

  const { statementPeriod, bbox: periodBbox } = parseStatementPeriod(lines);
  if (periodBbox) bb.statementPeriod = periodBbox;

  const summary = parseSummary(lines);
  const transactions = parseTransactions(lines);

  return {
    accountHolder,
    accountNumber,
    accountType,
    statementPeriod,
    summary,
    transactions,
    boundingBoxes: bb,
  };
}

// ── Month abbreviations ─────────────────────────────────────────────────────

const MONTH_ABBR: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function parseMonthDayYear(raw: string): DateString {
  // "Dec 01 2025" or "Dec 31 2025"
  const m = raw.trim().match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${MONTH_ABBR[m[1]]}-${m[2].padStart(2, "0")}`;
}

// ── Account type ────────────────────────────────────────────────────────────

function parseAccountType(lines: TextLine[]): { accountType: string; bbox: BoundingBox | null } {
  for (const line of lines) {
    if (line.page !== 1) break;
    const text = line.fullText.trim();
    // TD Bank account type lines: "TD Business Convenience Plus", "TD Beyond Checking", etc.
    if (/^TD\s+(Business|Personal|Beyond|Convenience|Simple)/i.test(text)) {
      return { accountType: text, bbox: toBBox(line.segments[0], line) };
    }
  }
  return { accountType: "", bbox: null };
}

// ── Account holder ──────────────────────────────────────────────────────────

function parseAccountHolder(lines: TextLine[]): AccountHolder {
  const bb: Record<string, BoundingBox> = {};
  // Account holder info is on page 1 — left-side segments (x < 300) in the header area
  // Line 1: name + "Page: ..."
  // Line 2: street + "Statement Period: ..."
  // Line 3: city/state/zip + "Cust Ref #: ..."

  let name = "";
  const addressParts: string[] = [];

  for (const line of lines) {
    if (line.page !== 1) break;
    if (line.y > 180) break; // past the header area

    const leftSegs = line.segments.filter((s) => s.x < 300);
    if (leftSegs.length === 0) continue;
    const text = leftSegs.map((s) => s.text).join(" ").trim();

    // Skip non-address lines
    if (!text || /STATEMENT OF ACCOUNT|Bank|America|Go paperless/i.test(text)) continue;
    if (/^E$/.test(text)) continue; // standalone "E" marker

    if (!name) {
      name = text;
      bb.name = toBBox(leftSegs[0], line);
    } else {
      addressParts.push(text);
      if (addressParts.length === 1) bb.address = toBBox(leftSegs[0], line);
    }
  }

  return { name, address: addressParts.join(", "), boundingBoxes: bb };
}

// ── Account number ──────────────────────────────────────────────────────────

function parseAccountNumber(lines: TextLine[]): { accountNumber: string; bbox: BoundingBox | null } {
  for (const line of lines) {
    if (line.page !== 1) break;
    // "Primary Account #: 444-3328061" or "Account # 444-3328061"
    const m = line.fullText.match(/(?:Primary\s+)?Account\s*#:?\s*([\d-]+)/);
    if (m) {
      const seg = line.segments.find((s) => s.text.includes(m[1]));
      return { accountNumber: m[1], bbox: seg ? toBBox(seg, line) : null };
    }
  }
  return { accountNumber: "", bbox: null };
}

// ── Statement period ────────────────────────────────────────────────────────

function parseStatementPeriod(lines: TextLine[]): { statementPeriod: { from: DateString; to: DateString }; bbox: BoundingBox | null } {
  for (const line of lines) {
    if (line.page !== 1) break;
    // "Statement Period: Dec 01 2025-Dec 31 2025"
    const m = line.fullText.match(/Statement\s+Period:\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{4})\s*-\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{4})/);
    if (m) {
      const seg = line.segments.find((s) => s.text.includes(m[1]));
      return {
        statementPeriod: { from: parseMonthDayYear(m[1]), to: parseMonthDayYear(m[2]) },
        bbox: seg ? toBBox(seg, line) : null,
      };
    }
  }
  return { statementPeriod: { from: null, to: null }, bbox: null };
}

// ── Summary ─────────────────────────────────────────────────────────────────

function parseSummary(lines: TextLine[]): StatementSummary {
  const bb: Record<string, BoundingBox> = {};
  let beginningBalance = 0;
  let endingBalance = 0;
  let averageCollectedBalance: number | null = null;
  let interestEarnedThisPeriod: number | null = null;
  let interestPaidYearToDate: number | null = null;
  let annualPercentageYieldEarned = "";
  let daysInPeriod: number | null = null;

  let inSummary = false;

  for (const line of lines) {
    if (line.page !== 1) break;
    const text = line.fullText;

    if (/ACCOUNT SUMMARY/i.test(text)) {
      inSummary = true;
      continue;
    }
    if (!inSummary) continue;
    if (/DAILY ACCOUNT ACTIVITY/i.test(text)) break;

    // Parse left-side fields (x < 350)
    if (/Beginning Balance/i.test(text)) {
      const result = findAmountAfterLabel(line, /Beginning Balance/i);
      beginningBalance = result.value ?? 0;
      if (result.bbox) bb.beginningBalance = result.bbox;
    }

    if (/Ending Balance/i.test(text)) {
      const result = findAmountAfterLabel(line, /Ending Balance/i);
      endingBalance = result.value ?? 0;
      if (result.bbox) bb.endingBalance = result.bbox;
    }

    // Parse right-side fields (x > 350)
    if (/Average Collected Balance/i.test(text)) {
      const result = findAmountAfterLabel(line, /Average Collected Balance/i);
      averageCollectedBalance = result.value;
    }

    if (/Interest Earned This Period/i.test(text)) {
      const result = findAmountAfterLabel(line, /Interest Earned This Period/i);
      interestEarnedThisPeriod = result.value;
    }

    if (/Interest Paid Year-to-Date/i.test(text)) {
      const result = findAmountAfterLabel(line, /Interest Paid Year-to-Date/i);
      interestPaidYearToDate = result.value;
    }

    if (/Annual Percentage Yield Earned/i.test(text)) {
      for (const seg of line.segments) {
        if (/\d.*%/.test(seg.text)) {
          annualPercentageYieldEarned = seg.text.trim();
          break;
        }
      }
    }

    if (/Days in Period/i.test(text)) {
      for (const seg of line.segments) {
        const n = parseNum(seg.text);
        if (n !== null && !seg.text.includes("Days")) {
          daysInPeriod = n;
          break;
        }
      }
    }
  }

  return {
    beginningBalance,
    endingBalance,
    averageCollectedBalance,
    interestEarnedThisPeriod,
    interestPaidYearToDate,
    annualPercentageYieldEarned,
    daysInPeriod,
    boundingBoxes: bb,
  };
}

function findAmountAfterLabel(line: TextLine, labelRe: RegExp): { value: number | null; bbox: BoundingBox | null } {
  // Find the segment containing the label, then find the next numeric segment
  let foundLabel = false;
  for (const seg of line.segments) {
    if (!foundLabel && labelRe.test(seg.text)) {
      foundLabel = true;
      continue;
    }
    if (foundLabel) {
      const val = parseCurrency(seg.text);
      if (val !== null) return { value: val, bbox: toBBox(seg, line) };
    }
  }
  return { value: null, bbox: null };
}

// ── Transactions ────────────────────────────────────────────────────────────

function parseTransactions(lines: TextLine[]): Transaction[] {
  // Find "DAILY ACCOUNT ACTIVITY" header
  let txStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/DAILY ACCOUNT ACTIVITY/i.test(lines[i].fullText)) {
      txStart = i;
      break;
    }
  }
  if (txStart < 0) return [];

  const transactions: Transaction[] = [];
  let i = txStart + 1;

  // Skip "No Transactions" case
  if (i < lines.length && /No Transactions/i.test(lines[i].fullText)) {
    return [];
  }

  // Skip column headers until we find a transaction line (starts with a date)
  while (i < lines.length && !isTransactionLine(lines[i])) {
    // Stop if we hit the next section or page 2 boilerplate
    if (/How to Balance|FOR CONSUMER/i.test(lines[i].fullText)) return [];
    i++;
  }

  let current: Transaction | null = null;

  while (i < lines.length) {
    const line = lines[i];
    const text = line.fullText;

    // Stop conditions
    if (/How to Balance|FOR CONSUMER|Call 1-800/i.test(text)) break;
    if (line.page > 1 && /Page:/i.test(text)) break;

    if (isTransactionLine(line)) {
      if (current) transactions.push(current);
      current = buildTransaction(line);
    } else if (current && isContinuationLine(line)) {
      const descText = line.segments
        .filter((s) => s.x < 350)
        .map((s) => s.text.trim())
        .join(" ");
      if (descText) {
        current.description += " " + descText;
      }
    }

    i++;
  }

  if (current) transactions.push(current);
  return transactions;
}

function isTransactionLine(line: TextLine): boolean {
  const firstSeg = line.segments[0];
  if (!firstSeg || firstSeg.x > 100) return false;
  // TD Bank dates: "12/01", "12/31", etc.
  return /^\d{1,2}\/\d{1,2}$/.test(firstSeg.text.trim());
}

function isContinuationLine(line: TextLine): boolean {
  const firstSeg = line.segments[0];
  if (!firstSeg) return false;
  return firstSeg.x >= 100 && firstSeg.x <= 300;
}

function buildTransaction(line: TextLine): Transaction {
  const bb: Record<string, BoundingBox> = {};
  const dateSeg = line.segments[0];

  // Derive year from context — for now extract from page header
  const dateText = dateSeg.text.trim();
  bb.date = toBBox(dateSeg, line);

  const descParts: string[] = [];
  let descBbox: BoundingBox | null = null;
  let debit: number | null = null;
  let credit: number | null = null;
  let balance: number | null = null;

  for (let s = 1; s < line.segments.length; s++) {
    const seg = line.segments[s];
    const x = seg.x;
    const text = seg.text.trim();

    // Amounts are typically on the right side
    const val = parseCurrency(text);
    if (val !== null && x > 350) {
      // Rightmost amount is balance, then debit/credit
      if (balance === null && x > 450) {
        balance = val;
        bb.balance = toBBox(seg, line);
      } else if (debit === null) {
        // Negative amounts or amounts in debit column
        if (text.startsWith("-") || text.startsWith("(")) {
          debit = val;
          bb.debit = toBBox(seg, line);
        } else {
          credit = val;
          bb.credit = toBBox(seg, line);
        }
      }
    } else {
      descParts.push(text);
      if (!descBbox) descBbox = toBBox(seg, line);
    }
  }

  if (descBbox) bb.description = descBbox;

  return {
    date: dateText,
    description: descParts.join(" ").trim(),
    debit,
    credit,
    balance,
    boundingBoxes: bb,
  };
}
