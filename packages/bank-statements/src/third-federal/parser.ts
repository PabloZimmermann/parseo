import { extractLines, parseCurrency, toBBox, UnrecognizedFormatError } from "@parseo/shared";
import type { TextLine, DateString, BoundingBox } from "@parseo/shared";
import type {
  ThirdFederalStatement,
  AccountHolder,
  MonthlyStatement,
  AccountSummary,
  PaymentSummary,
  Transaction,
} from "./types.js";

export async function parseThirdFederalStatement(buffer: Buffer): Promise<ThirdFederalStatement> {
  const lines = await extractLines(buffer);
  return parseThirdFederalFromLines(lines);
}

export function parseThirdFederalFromLines(lines: TextLine[]): ThirdFederalStatement {
  const head = lines.slice(0, 30).map((l) => l.fullText).join("\n");
  if (!/Equity Line of Credit/i.test(head) && !/Third Federal/i.test(head) && !/thirdfederal/i.test(head)) {
    throw new UnrecognizedFormatError(
      "ThirdFederal",
      "first 30 lines do not contain a Third Federal signature"
    );
  }

  const bb: Record<string, BoundingBox> = {};

  // Split lines into per-statement groups by page
  const statementPages = findStatementPages(lines);

  const accountHolder = parseAccountHolder(lines, statementPages[0] ?? 1);
  const accountNumber = parseAccountNumber(lines, statementPages[0] ?? 1);
  const accountType = parseAccountType(lines, statementPages[0] ?? 1);

  const monthly: MonthlyStatement[] = [];
  for (const page of statementPages) {
    const pageLines = lines.filter((l) => l.page === page);
    const stmt = parseMonthlyStatement(pageLines, page);
    if (stmt) monthly.push(stmt);
  }

  let totalDeposits = 0;
  let totalWithdrawals = 0;
  for (const stmt of monthly) {
    totalDeposits += stmt.summary.advancesAndDebits;
    totalWithdrawals += stmt.summary.paymentsAndCredits;
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
    if (/Equity Line of Credit Statement/i.test(line.fullText)) {
      pages.add(line.page);
    }
  }
  return [...pages].sort((a, b) => a - b);
}

// ── Account holder ────────────────────────────────────────────────────────

function parseAccountHolder(lines: TextLine[], page: number): AccountHolder {
  const bb: Record<string, BoundingBox> = {};
  const pageLines = lines.filter((l) => l.page === page);

  // Name and address are on the left side (x≈108), y between ~190 and ~220
  const addrLines: { text: string; line: TextLine; seg: import("@parseo/shared").TextSegment }[] = [];
  for (const line of pageLines) {
    if (line.y < 190 || line.y > 230) continue;
    const leftSegs = line.segments.filter((s) => s.x < 300 && s.x >= 90);
    if (leftSegs.length === 0) continue;
    const text = leftSegs.map((s) => s.text).join(" ").trim();
    if (!text) continue;
    addrLines.push({ text, line, seg: leftSegs[0] });
  }

  const name = addrLines[0]?.text ?? "";
  if (addrLines[0]) bb.name = toBBox(addrLines[0].seg, addrLines[0].line);

  const addressParts: string[] = [];
  for (let i = 1; i < addrLines.length; i++) {
    addressParts.push(addrLines[i].text);
    if (i === 1) bb.address = toBBox(addrLines[i].seg, addrLines[i].line);
  }

  return { name, address: addressParts.join(", "), boundingBoxes: bb };
}

// ── Account number ────────────────────────────────────────────────────────

function parseAccountNumber(lines: TextLine[], page: number): string {
  for (const line of lines) {
    if (line.page !== page) continue;
    const m = line.fullText.match(/Account\s*Number:\s*(\d+)/i);
    if (m) return m[1];
  }
  return "";
}

// ── Account type ──────────────────────────────────────────────────────────

function parseAccountType(lines: TextLine[], page: number): string {
  for (const line of lines) {
    if (line.page !== page) continue;
    if (/Equity Line of Credit Statement/i.test(line.fullText)) {
      return "Equity Line of Credit";
    }
  }
  return "";
}

// ── Monthly statement ─────────────────────────────────────────────────────

const AMOUNT_MIN_X = 300;
const PRINCIPAL_AMT_MIN_X = 390;
const PRINCIPAL_BAL_MIN_X = 480;

function parseMonthlyStatement(pageLines: TextLine[], page: number): MonthlyStatement | null {
  const bb: Record<string, BoundingBox> = {};

  // Closing date
  const closingDate = parseClosingDate(pageLines);
  if (!closingDate) return null;
  bb.closingDate = closingDate.bbox;

  // Previous statement date
  const prevDate = parsePreviousStatementDate(pageLines);

  // Derive year for transaction dates
  const closingYear = parseInt(closingDate.date!.slice(0, 4), 10);
  const closingMonth = parseInt(closingDate.date!.slice(5, 7), 10);

  // Transactions
  const transactions = parseTransactions(pageLines, closingYear, closingMonth);

  // Account summary
  const summary = parseAccountSummary(pageLines);

  // Payment summary
  const paymentSummary = parsePaymentSummary(pageLines);

  return {
    closingDate: closingDate.date,
    previousStatementDate: prevDate,
    summary,
    paymentSummary,
    transactions,
    boundingBoxes: bb,
  };
}

function parseClosingDate(pageLines: TextLine[]): { date: DateString; bbox: BoundingBox } | null {
  for (const line of pageLines) {
    const m = line.fullText.match(/Statement Closing Date:\s*(\d{2}\/\d{2}\/\d{4})/);
    if (m) {
      const [mm, dd, yyyy] = m[1].split("/");
      const seg = line.segments.find((s) => s.text.includes("Statement Closing Date"));
      return {
        date: `${yyyy}-${mm}-${dd}`,
        bbox: seg ? toBBox(seg, line) : toBBox(line.segments[0], line),
      };
    }
  }
  return null;
}

function parsePreviousStatementDate(pageLines: TextLine[]): DateString {
  for (const line of pageLines) {
    const m = line.fullText.match(/Previous Stmt Date\s+(\d{2}\/\d{2}\/\d{2})/);
    if (m) {
      const [mm, dd, yy] = m[1].split("/");
      const fullYear = parseInt(yy, 10) >= 80 ? `19${yy}` : `20${yy}`;
      return `${fullYear}-${mm}-${dd}`;
    }
  }
  return null;
}

// ── Transactions ──────────────────────────────────────────────────────────

function parseTransactions(
  pageLines: TextLine[],
  closingYear: number,
  closingMonth: number,
): Transaction[] {
  const transactions: Transaction[] = [];

  // Find transaction section: starts after "Date Description of Transactions" header
  let inSection = false;
  for (const line of pageLines) {
    const text = line.fullText.trim();

    if (/^Date Description of Transactions/i.test(text)) {
      inSection = true;
      continue;
    }

    if (!inSection) continue;

    // End conditions
    if (/^Account Summary/i.test(text)) break;

    // Parse transaction line: first segment starts with "MM/DD "
    const firstSeg = line.segments[0];
    if (!firstSeg) continue;

    const dateMatch = firstSeg.text.trim().match(/^(\d{2})\/(\d{2})\s+(.+)/);
    if (!dateMatch) continue;

    const bb: Record<string, BoundingBox> = {};

    const txMonth = parseInt(dateMatch[1], 10);
    const txDay = dateMatch[2];
    const year = txMonth > closingMonth ? closingYear - 1 : closingYear;
    const date: DateString = `${year}-${dateMatch[1]}-${txDay}`;
    bb.date = toBBox(firstSeg, line);

    let description = dateMatch[3].trim();
    bb.description = toBBox(firstSeg, line);

    // Additional description segments before the amount columns
    for (let s = 1; s < line.segments.length; s++) {
      const seg = line.segments[s];
      if (seg.x < AMOUNT_MIN_X) {
        description += " " + seg.text.trim();
      }
    }

    // Skip "Previous Balance" — not a real transaction
    if (/Previous Balance/i.test(description)) continue;

    // Amount: segment at x >= 300 and < 390
    let amount: number | null = null;
    const amtSegs = line.segments.filter((s) => s.x >= AMOUNT_MIN_X && s.x < PRINCIPAL_AMT_MIN_X);
    if (amtSegs.length > 0) {
      const amtText = amtSegs[0].text.trim();
      const isNeg = amtText.endsWith("-");
      const cleanAmt = amtText.replace(/-$/, "");
      const val = parseCurrency(cleanAmt);
      if (val !== null) {
        amount = isNeg ? -val : val;
        bb.amount = toBBox(amtSegs[0], line);
      }
    }

    // Principal Amount: segment at x >= 390 and < 480
    let principalAmount: number | null = null;
    const pAmtSegs = line.segments.filter((s) => s.x >= PRINCIPAL_AMT_MIN_X && s.x < PRINCIPAL_BAL_MIN_X);
    if (pAmtSegs.length > 0) {
      const pAmtText = pAmtSegs[0].text.trim();
      const isNeg = pAmtText.endsWith("-");
      const cleanAmt = pAmtText.replace(/-$/, "");
      const val = parseCurrency(cleanAmt);
      if (val !== null) {
        principalAmount = isNeg ? -val : val;
        bb.principalAmount = toBBox(pAmtSegs[0], line);
      }
    }

    // Principal Balance: segment at x >= 480
    let principalBalance: number | null = null;
    const pBalSegs = line.segments.filter((s) => s.x >= PRINCIPAL_BAL_MIN_X);
    if (pBalSegs.length > 0) {
      const val = parseCurrency(pBalSegs[0].text);
      if (val !== null) {
        principalBalance = val;
        bb.principalBalance = toBBox(pBalSegs[0], line);
      }
    }

    transactions.push({ date, description, amount, principalAmount, principalBalance, boundingBoxes: bb });
  }

  return transactions;
}

// ── Account summary ───────────────────────────────────────────────────────

function parseAccountSummary(pageLines: TextLine[]): AccountSummary {
  const bb: Record<string, BoundingBox> = {};
  let previousBalance = 0;
  let advancesAndDebits = 0;
  let paymentsAndCredits = 0;
  let newBalance = 0;
  let creditLimit = 0;
  let availableCredit = 0;

  for (const line of pageLines) {
    const text = line.fullText;

    // Left-side summary fields (x < 338)
    const leftSegs = line.segments.filter((s) => s.x < 338);
    if (leftSegs.length === 0) continue;
    const leftText = leftSegs.map((s) => s.text).join(" ");

    if (/Previous Stmt Balance/i.test(leftText)) {
      const valSeg = leftSegs.find((s) => parseCurrency(s.text) !== null && s.x > 200);
      if (valSeg) {
        previousBalance = parseCurrency(valSeg.text) ?? 0;
        bb.previousBalance = toBBox(valSeg, line);
      }
    } else if (/\+\s*Advances\s*&\s*Debits/i.test(leftText)) {
      const valSeg = leftSegs.find((s) => parseCurrency(s.text) !== null && s.x > 200);
      if (valSeg) {
        advancesAndDebits = parseCurrency(valSeg.text) ?? 0;
        bb.advancesAndDebits = toBBox(valSeg, line);
      }
    } else if (/-\s*Payments\s*&\s*Credits/i.test(leftText)) {
      const valSeg = leftSegs.find((s) => parseCurrency(s.text) !== null && s.x > 200);
      if (valSeg) {
        paymentsAndCredits = parseCurrency(valSeg.text) ?? 0;
        bb.paymentsAndCredits = toBBox(valSeg, line);
      }
    } else if (/New Balance\**/i.test(leftText)) {
      const valSeg = leftSegs.find((s) => parseCurrency(s.text) !== null && s.x > 200);
      if (valSeg) {
        newBalance = parseCurrency(valSeg.text) ?? 0;
        bb.newBalance = toBBox(valSeg, line);
      }
    } else if (/Credit Limit/i.test(leftText) && !/Available/i.test(leftText) && !/Amount Over/i.test(leftText)) {
      const valSeg = leftSegs.find((s) => parseCurrency(s.text) !== null && s.x > 200);
      if (valSeg) {
        creditLimit = parseCurrency(valSeg.text) ?? 0;
        bb.creditLimit = toBBox(valSeg, line);
      }
    } else if (/Available Credit/i.test(leftText)) {
      const valSeg = leftSegs.find((s) => parseCurrency(s.text) !== null && s.x > 200);
      if (valSeg) {
        availableCredit = parseCurrency(valSeg.text) ?? 0;
        bb.availableCredit = toBBox(valSeg, line);
      }
    }
  }

  return { previousBalance, advancesAndDebits, paymentsAndCredits, newBalance, creditLimit, availableCredit, boundingBoxes: bb };
}

// ── Payment summary ──────────────────────────────────────────────────────

function parsePaymentSummary(pageLines: TextLine[]): PaymentSummary {
  const bb: Record<string, BoundingBox> = {};
  let unpaidAmount = 0;
  let principal = 0;
  let financeCharges = 0;
  let otherCharges = 0;
  let fees = 0;
  let lateCharges = 0;
  let minimumPayment = 0;

  for (const line of pageLines) {
    // Right-side payment summary fields (x >= 338)
    const rightSegs = line.segments.filter((s) => s.x >= 338);
    if (rightSegs.length === 0) continue;
    const rightText = rightSegs.map((s) => s.text).join(" ");

    const valSeg = rightSegs.find((s) => parseCurrency(s.text) !== null && s.x > 480);

    if (/Unpaid amount/i.test(rightText) && valSeg) {
      unpaidAmount = parseCurrency(valSeg.text) ?? 0;
      bb.unpaidAmount = toBBox(valSeg, line);
    } else if (/^Principal$/i.test(rightSegs[0]?.text.trim()) && valSeg) {
      principal = parseCurrency(valSeg.text) ?? 0;
      bb.principal = toBBox(valSeg, line);
    } else if (/Finance Charges/i.test(rightText) && valSeg) {
      financeCharges = parseCurrency(valSeg.text) ?? 0;
      bb.financeCharges = toBBox(valSeg, line);
    } else if (/Other Charges/i.test(rightText) && valSeg) {
      otherCharges = parseCurrency(valSeg.text) ?? 0;
      bb.otherCharges = toBBox(valSeg, line);
    } else if (/^Fees$/i.test(rightSegs[0]?.text.trim()) && valSeg) {
      fees = parseCurrency(valSeg.text) ?? 0;
      bb.fees = toBBox(valSeg, line);
    } else if (/Late Charges/i.test(rightText) && valSeg) {
      lateCharges = parseCurrency(valSeg.text) ?? 0;
      bb.lateCharges = toBBox(valSeg, line);
    } else if (/Minimum Payment/i.test(rightText)) {
      const mpSeg = rightSegs.find((s) => parseCurrency(s.text) !== null && s.x > 480);
      if (mpSeg) {
        minimumPayment = parseCurrency(mpSeg.text) ?? 0;
        bb.minimumPayment = toBBox(mpSeg, line);
      }
    }
  }

  return { unpaidAmount, principal, financeCharges, otherCharges, fees, lateCharges, minimumPayment, boundingBoxes: bb };
}
