import { extractLines, parseCurrency, toBBox, UnrecognizedFormatError } from "@parseo/shared";
import type { TextLine, DateString, BoundingBox } from "@parseo/shared";
import type {
  GroveBankStatement,
  AccountHolder,
  MonthlyStatement,
  AccountSummary,
  Transaction,
} from "./types.js";

export async function parseGroveBankStatement(buffer: Buffer): Promise<GroveBankStatement> {
  const lines = await extractLines(buffer);
  return parseGroveBankFromLines(lines);
}

export function parseGroveBankFromLines(lines: TextLine[]): GroveBankStatement {
  const head = lines.slice(0, 30).map((l) => l.fullText).join("\n");
  if (!/grove\s*bank/i.test(head) && !/grovebankandtrust/i.test(head)) {
    throw new UnrecognizedFormatError(
      "GroveBank",
      "first 30 lines do not contain a Grove Bank signature"
    );
  }

  const bb: Record<string, BoundingBox> = {};

  // Each statement is on a separate page with "CHECKING ACCOUNTS" header
  const statementPages = findStatementPages(lines);

  const accountHolder = parseAccountHolder(lines, statementPages[0] ?? 1);
  const accountNumber = parseAccountNumber(lines, statementPages[0] ?? 1);
  const accountType = parseAccountType(lines, statementPages[0] ?? 1);

  const monthly: MonthlyStatement[] = [];
  for (const page of statementPages) {
    const pageLines = lines.filter((l) => l.page === page);
    const stmt = parseMonthlyStatement(pageLines);
    if (stmt) monthly.push(stmt);
  }

  let totalDeposits = 0;
  let totalWithdrawals = 0;
  for (const stmt of monthly) {
    totalDeposits += stmt.summary.depositsCredits;
    totalWithdrawals += stmt.summary.checksDebits;
  }

  return {
    accountHolder,
    accountNumber,
    accountType,
    statements: monthly,
    totalDeposits,
    totalWithdrawals,
    boundingBoxes: bb,
  };
}

// ── Find statement pages ──────────────────────────────────────────────────

function findStatementPages(lines: TextLine[]): number[] {
  const pages = new Set<number>();
  for (const line of lines) {
    if (/CHECKING ACCOUNTS/i.test(line.fullText)) {
      pages.add(line.page);
    }
  }
  return [...pages].sort((a, b) => a - b);
}

// ── Account holder ────────────────────────────────────────────────────────

function parseAccountHolder(lines: TextLine[], page: number): AccountHolder {
  const bb: Record<string, BoundingBox> = {};
  const pageLines = lines.filter((l) => l.page === page);

  // Name is at x≈126, y≈146 (same line as "Primary Account")
  // Address lines follow at y≈156 and y≈166
  let name = "";
  const addressParts: string[] = [];

  for (const line of pageLines) {
    if (line.y < 140 || line.y > 175) continue;
    const leftSegs = line.segments.filter((s) => s.x < 300 && s.x >= 100);
    if (leftSegs.length === 0) continue;
    const text = leftSegs.map((s) => s.text).join(" ").trim();
    if (!text) continue;

    if (!name) {
      name = text;
      bb.name = toBBox(leftSegs[0], line);
    } else {
      addressParts.push(text);
      if (!bb.address) bb.address = toBBox(leftSegs[0], line);
    }
  }

  return { name, address: addressParts.join(", "), boundingBoxes: bb };
}

// ── Account number ────────────────────────────────────────────────────────

function parseAccountNumber(lines: TextLine[], page: number): string {
  for (const line of lines) {
    if (line.page !== page) continue;
    const m = line.fullText.match(/Account\s*Number\s+(\d+)/i);
    if (m) return m[1];
  }
  return "";
}

// ── Account type ──────────────────────────────────────────────────────────

function parseAccountType(lines: TextLine[], page: number): string {
  for (const line of lines) {
    if (line.page !== page) continue;
    if (/Business Checking/i.test(line.fullText)) {
      return "Business Checking";
    }
  }
  return "Checking";
}

// ── Monthly statement ─────────────────────────────────────────────────────

function parseMonthlyStatement(pageLines: TextLine[]): MonthlyStatement | null {
  const bb: Record<string, BoundingBox> = {};

  // Statement date: "Date 2/28/25"
  const stmtDate = parseStatementDate(pageLines);
  if (!stmtDate) return null;
  bb.statementDate = stmtDate.bbox;

  // Statement period: "Statement Dates  2/04/25 thru 3/02/25"
  const period = parseStatementPeriod(pageLines);
  bb.statementPeriod = period?.bbox ?? stmtDate.bbox;

  // Summary
  const summary = parseAccountSummary(pageLines);

  // Transactions
  const transactions = parseTransactions(pageLines, stmtDate.year);

  return {
    statementDate: stmtDate.date,
    statementPeriod: period?.period ?? { start: stmtDate.date, end: stmtDate.date },
    summary,
    transactions,
    boundingBoxes: bb,
  };
}

// ── Statement date ────────────────────────────────────────────────────────

function parseStatementDate(
  pageLines: TextLine[],
): { date: DateString; year: number; bbox: BoundingBox } | null {
  for (const line of pageLines) {
    const m = line.fullText.match(/Date\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) {
      const mm = m[1].padStart(2, "0");
      const dd = m[2].padStart(2, "0");
      const year = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
      const seg = line.segments.find((s) => /Date\s+\d/.test(s.text));
      return {
        date: `${year}-${mm}-${dd}`,
        year,
        bbox: seg ? toBBox(seg, line) : toBBox(line.segments[0], line),
      };
    }
  }
  return null;
}

// ── Statement period ──────────────────────────────────────────────────────

function parseStatementPeriod(
  pageLines: TextLine[],
): { period: { start: DateString; end: DateString }; bbox: BoundingBox } | null {
  for (const line of pageLines) {
    const m = line.fullText.match(
      /Statement\s+Dates\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+thru\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i
    );
    if (m) {
      const startYear = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
      const endYear = m[6].length === 2 ? 2000 + parseInt(m[6], 10) : parseInt(m[6], 10);
      const seg = line.segments.find((s) => /\d+\/\d+\/\d+.*thru/i.test(s.text));
      return {
        period: {
          start: `${startYear}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`,
          end: `${endYear}-${m[4].padStart(2, "0")}-${m[5].padStart(2, "0")}`,
        },
        bbox: seg ? toBBox(seg, line) : toBBox(line.segments[0], line),
      };
    }
  }
  return null;
}

// ── Account summary ───────────────────────────────────────────────────────

function parseAccountSummary(pageLines: TextLine[]): AccountSummary {
  const bb: Record<string, BoundingBox> = {};
  let previousBalance = 0;
  let depositsCredits = 0;
  let checksDebits = 0;
  let serviceCharge = 0;
  let interestPaid = 0;
  let currentBalance = 0;
  let daysInPeriod = 0;
  let averageLedger = 0;
  let averageCollected = 0;

  for (const line of pageLines) {
    const text = line.fullText;

    // Left-side summary fields (x < 340)
    if (/Previous Balance/i.test(text)) {
      const valSeg = line.segments.find((s) => s.x > 200 && s.x < 340 && parseCurrency(s.text) !== null);
      if (valSeg) {
        previousBalance = parseCurrency(valSeg.text) ?? 0;
        bb.previousBalance = toBBox(valSeg, line);
      }
    }

    if (/Deposits\/Credits/i.test(text)) {
      const valSeg = line.segments.find((s) => s.x > 200 && s.x < 340 && parseCurrency(s.text) !== null);
      if (valSeg) {
        depositsCredits = parseCurrency(valSeg.text) ?? 0;
        bb.depositsCredits = toBBox(valSeg, line);
      }
    }

    if (/Checks\/Debits/i.test(text)) {
      const valSeg = line.segments.find((s) => s.x > 200 && s.x < 340 && parseCurrency(s.text) !== null);
      if (valSeg) {
        checksDebits = parseCurrency(valSeg.text) ?? 0;
        bb.checksDebits = toBBox(valSeg, line);
      }
    }

    if (/Service Charge/i.test(text) && !/SERVICE CHARGE SUMMARY/i.test(text)) {
      const valSeg = line.segments.find((s) => s.x > 200 && s.x < 340 && parseCurrency(s.text) !== null);
      if (valSeg) {
        serviceCharge = parseCurrency(valSeg.text) ?? 0;
        bb.serviceCharge = toBBox(valSeg, line);
      }
    }

    if (/Interest Paid/i.test(text)) {
      const valSeg = line.segments.find((s) => s.x > 200 && s.x < 340 && parseCurrency(s.text) !== null);
      if (valSeg) {
        interestPaid = parseCurrency(valSeg.text) ?? 0;
        bb.interestPaid = toBBox(valSeg, line);
      }
    }

    if (/Current Balance/i.test(text)) {
      const valSeg = line.segments.find((s) => s.x > 200 && s.x < 340 && parseCurrency(s.text) !== null);
      if (valSeg) {
        currentBalance = parseCurrency(valSeg.text) ?? 0;
        bb.currentBalance = toBBox(valSeg, line);
      }
    }

    // Right-side summary fields (x >= 340)
    if (/Days in the statement period/i.test(text)) {
      const valSeg = line.segments.find((s) => s.x > 500 && /^\d+$/.test(s.text.trim()));
      if (valSeg) {
        daysInPeriod = parseInt(valSeg.text.trim(), 10);
        bb.daysInPeriod = toBBox(valSeg, line);
      }
    }

    if (/Average Ledger/i.test(text)) {
      const valSeg = line.segments.find((s) => s.x > 480 && parseCurrency(s.text) !== null);
      if (valSeg) {
        averageLedger = parseCurrency(valSeg.text) ?? 0;
        bb.averageLedger = toBBox(valSeg, line);
      }
    }

    if (/Average Collected/i.test(text)) {
      const valSeg = line.segments.find((s) => s.x > 480 && parseCurrency(s.text) !== null);
      if (valSeg) {
        averageCollected = parseCurrency(valSeg.text) ?? 0;
        bb.averageCollected = toBBox(valSeg, line);
      }
    }
  }

  return {
    previousBalance,
    depositsCredits,
    checksDebits,
    serviceCharge,
    interestPaid,
    currentBalance,
    daysInPeriod,
    averageLedger,
    averageCollected,
    boundingBoxes: bb,
  };
}

// ── Transactions ──────────────────────────────────────────────────────────

const AMOUNT_MIN_X = 350;

function parseTransactions(pageLines: TextLine[], year: number): Transaction[] {
  const transactions: Transaction[] = [];

  let currentSection: "deposit" | "withdrawal" | null = null;

  for (const line of pageLines) {
    const text = line.fullText.trim();

    // Section headers
    if (/^Deposits and Credits$/i.test(text)) {
      currentSection = "deposit";
      continue;
    }
    if (/^Withdrawals and Debits$/i.test(text)) {
      currentSection = "withdrawal";
      continue;
    }

    // End of transaction sections
    if (/^DAILY BALANCE INFORMATION$/i.test(text)) {
      currentSection = null;
      continue;
    }
    if (/^Thank you for banking/i.test(text)) {
      currentSection = null;
      continue;
    }

    if (!currentSection) continue;

    // Skip column headers
    if (/^Date\s+Description/i.test(text)) continue;

    // Parse transaction: date at x≈90, description at x≈144, amount at x>350
    const firstSeg = line.segments[0];
    if (!firstSeg) continue;

    const dateMatch = firstSeg.text.trim().match(/^(\d{1,2})\/(\d{1,2})$/);
    if (!dateMatch) continue;

    const txBb: Record<string, BoundingBox> = {};
    const mm = dateMatch[1].padStart(2, "0");
    const dd = dateMatch[2].padStart(2, "0");
    const date: DateString = `${year}-${mm}-${dd}`;
    txBb.date = toBBox(firstSeg, line);

    // Description: segments between date and amount columns
    const descSegs = line.segments.filter((s) => s.x > 120 && s.x < AMOUNT_MIN_X);
    const description = descSegs.map((s) => s.text).join(" ").trim();
    if (descSegs.length > 0) txBb.description = toBBox(descSegs[0], line);

    // Amount: segment at x >= AMOUNT_MIN_X
    const amtSegs = line.segments.filter((s) => s.x >= AMOUNT_MIN_X);
    if (amtSegs.length === 0) continue;

    const amtText = amtSegs[0].text.trim();
    const isNeg = amtText.endsWith("-");
    const cleanAmt = amtText.replace(/-$/, "");
    const val = parseCurrency(cleanAmt);
    if (val === null) continue;

    const amount = isNeg ? -val : val;
    txBb.amount = toBBox(amtSegs[0], line);

    transactions.push({
      date,
      description,
      amount,
      type: currentSection,
      boundingBoxes: txBb,
    });
  }

  return transactions;
}
