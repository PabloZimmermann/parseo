import { extractLines, parseCurrency, toBBox, UnrecognizedFormatError } from "@parseo/shared";
import type { TextLine, DateString, BoundingBox } from "@parseo/shared";
import type {
  DiscoverStatement,
  AccountHolder,
  AccountSummary,
  Transaction,
} from "./types.js";

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

export async function parseDiscoverStatement(buffer: Buffer): Promise<DiscoverStatement> {
  const lines = await extractLines(buffer);
  return parseDiscoverFromLines(lines);
}

export function parseDiscoverFromLines(lines: TextLine[]): DiscoverStatement {
  const head = lines.slice(0, 30).map((l) => l.fullText).join("\n");
  if (!/Discover/i.test(head) && !/1-800-347-7000/.test(head)) {
    throw new UnrecognizedFormatError(
      "Discover",
      "first 30 lines do not contain a Discover signature"
    );
  }

  const bb: Record<string, BoundingBox> = {};
  const accountHolder = parseAccountHolder(lines);
  const { accountNumber, accountType } = parseAccountInfo(lines);
  const statementPeriod = parseStatementPeriod(lines);
  const year = parseInt(statementPeriod.end?.slice(0, 4) ?? "2025", 10);
  const summary = parseAccountSummary(lines);
  const transactions = parseTransactions(lines, year);

  const totalDeposits = summary.depositsAndCredits;
  const totalWithdrawals =
    summary.checks +
    summary.atmAndDebitCardWithdrawals +
    summary.electronicWithdrawals +
    summary.serviceCharges;

  return {
    accountHolder,
    accountNumber,
    accountType,
    statementPeriod,
    summary,
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

  let name = "";
  const addressParts: string[] = [];

  // Account holder name and address appear in the deposit slip area
  // around y=636-658, x≈45
  for (const line of page1) {
    if (line.y < 620 || line.y > 670) continue;
    const segs = line.segments.filter((s) => s.x >= 30 && s.x < 200);
    if (segs.length === 0) continue;
    const text = segs.map((s) => s.text).join(" ").trim();
    if (!text) continue;

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
  let accountNumber = "";
  let accountType = "";

  for (const line of lines) {
    if (line.page !== 1) continue;

    if (!accountNumber) {
      const m = line.fullText.match(/Account Number:\s*([\d-]+)/i);
      if (m) accountNumber = m[1];
    }
    if (!accountType && line.y < 60) {
      const m = line.fullText.match(/^(MONEY MARKET|SAVINGS|CHECKING|CD)/i);
      if (m) accountType = m[1];
    }
  }

  return { accountNumber, accountType };
}

// ── Statement period ──────────────────────────────────────────────────────

function parseStatementPeriod(lines: TextLine[]): { start: DateString; end: DateString } {
  for (const line of lines) {
    if (line.page !== 1) continue;
    // "Statement Period: Aug 01, 2025 - Aug 31, 2025"
    const m = line.fullText.match(
      /Statement Period:\s*(\w{3})\s+(\d{2}),?\s+(\d{4})\s*-\s*(\w{3})\s+(\d{2}),?\s+(\d{4})/i
    );
    if (m) {
      const startMonth = MONTHS[m[1]] ?? "01";
      const endMonth = MONTHS[m[4]] ?? "01";
      return {
        start: `${m[3]}-${startMonth}-${m[2]}`,
        end: `${m[6]}-${endMonth}-${m[5]}`,
      };
    }
  }
  return { start: null, end: null };
}

// ── Account summary ──────────────────────────────────────────────────────

function parseSummaryValue(text: string): number {
  // Extract dollar amount from dotted leader text like:
  // "* 1 * Beginning Balance ..........................................................$20,053.48"
  // "Deposits and Credits.........................................................+$1,600.13"
  const m = text.match(/[+-]?\$([\d,.]+)\s*$/);
  if (m) return parseCurrency(m[1]) ?? 0;
  return 0;
}

function parseSummaryPercent(text: string): number {
  const m = text.match(/(\d+(?:\.\d+)?)%/);
  if (m) return parseFloat(m[1]);
  return 0;
}

function parseSummaryInt(text: string): number {
  // "Days in Statement Period..................................................................31"
  const m = text.match(/(\d+)\s*$/);
  if (m) return parseInt(m[1], 10);
  return 0;
}

function parseAccountSummary(lines: TextLine[]): AccountSummary {
  const bb: Record<string, BoundingBox> = {};
  const summary: AccountSummary = {
    beginningBalance: 0,
    depositsAndCredits: 0,
    checks: 0,
    atmAndDebitCardWithdrawals: 0,
    electronicWithdrawals: 0,
    serviceCharges: 0,
    endingBalance: 0,
    apyEarned: 0,
    interestThisPeriod: 0,
    interestYTD: 0,
    daysInPeriod: 0,
    averageDailyBalance: 0,
    boundingBoxes: bb,
  };

  for (const line of lines) {
    if (line.page !== 1) continue;
    if (line.y < 120 || line.y > 200) continue;

    // Each segment on these lines contains dotted-leader text with the value embedded
    for (const seg of line.segments) {
      const text = seg.text;

      if (/Beginning Balance/i.test(text)) {
        summary.beginningBalance = parseSummaryValue(text);
        bb.beginningBalance = toBBox(seg, line);
      } else if (/Deposits and Credits/i.test(text)) {
        summary.depositsAndCredits = parseSummaryValue(text);
        bb.depositsAndCredits = toBBox(seg, line);
      } else if (/^Checks\b/i.test(text.replace(/[.*]/g, "").trim())) {
        summary.checks = parseSummaryValue(text);
        bb.checks = toBBox(seg, line);
      } else if (/ATM and Debit Card/i.test(text)) {
        summary.atmAndDebitCardWithdrawals = parseSummaryValue(text);
        bb.atmAndDebitCardWithdrawals = toBBox(seg, line);
      } else if (/Electronic Withdrawals/i.test(text)) {
        summary.electronicWithdrawals = parseSummaryValue(text);
        bb.electronicWithdrawals = toBBox(seg, line);
      } else if (/Service Charges/i.test(text)) {
        summary.serviceCharges = parseSummaryValue(text);
        bb.serviceCharges = toBBox(seg, line);
      } else if (/Ending Balance/i.test(text)) {
        summary.endingBalance = parseSummaryValue(text);
        bb.endingBalance = toBBox(seg, line);
      } else if (/Annual Percentage Yield/i.test(text)) {
        summary.apyEarned = parseSummaryPercent(text);
        bb.apyEarned = toBBox(seg, line);
      } else if (/Interest Earned This Period/i.test(text)) {
        summary.interestThisPeriod = parseSummaryValue(text);
        bb.interestThisPeriod = toBBox(seg, line);
      } else if (/Interest Paid Year/i.test(text)) {
        summary.interestYTD = parseSummaryValue(text);
        bb.interestYTD = toBBox(seg, line);
      } else if (/Days in Statement/i.test(text)) {
        summary.daysInPeriod = parseSummaryInt(text);
        bb.daysInPeriod = toBBox(seg, line);
      } else if (/Average Daily Balance/i.test(text)) {
        summary.averageDailyBalance = parseSummaryValue(text);
        bb.averageDailyBalance = toBBox(seg, line);
      }
    }
  }

  return summary;
}

// ── Transactions ──────────────────────────────────────────────────────────

const DEPOSIT_SECTIONS = new Set([
  "Deposits and Credits",
]);

const WITHDRAWAL_SECTIONS = new Set([
  "Electronic Withdrawals",
  "Checks",
  "ATM and Debit Card Withdrawals",
  "Service Charges, Fees, and Other Withdrawals",
]);

const ALL_SECTIONS = [
  "Deposits and Credits",
  "Electronic Withdrawals",
  "Checks",
  "ATM and Debit Card Withdrawals",
  "Service Charges, Fees, and Other Withdrawals",
];

function parseMonthDay(text: string, year: number): DateString {
  // "Aug 19" → "2025-08-19"
  const m = text.trim().match(/(\w{3})\s+(\d{1,2})/);
  if (!m) return null;
  const month = MONTHS[m[1]];
  if (!month) return null;
  const day = m[2].padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseTransactions(lines: TextLine[], year: number): Transaction[] {
  const transactions: Transaction[] = [];
  let currentSection: string | null = null;
  let currentTx: Transaction | null = null;

  for (const line of lines) {
    const text = line.fullText.trim();

    // Detect section headers
    const matchedSection = ALL_SECTIONS.find((s) =>
      new RegExp("^" + s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i").test(text)
    );
    if (matchedSection) {
      if (currentTx) { transactions.push(currentTx); currentTx = null; }
      currentSection = matchedSection;
      continue;
    }

    // End of activity sections
    if (/^TOTAL\s/i.test(text)) {
      if (currentTx) { transactions.push(currentTx); currentTx = null; }
      continue;
    }

    // Skip non-section lines, headers
    if (!currentSection) continue;
    if (/^Eff\.\s*Date/i.test(text)) continue;
    if (/^ACCOUNT ACTIVITY$/i.test(text)) continue;
    if (/^ACCOUNT SUMMARY$/i.test(text)) {
      if (currentTx) { transactions.push(currentTx); currentTx = null; }
      currentSection = null;
      continue;
    }

    // Look for date segments — Eff. Date at x≈103.8
    const dateSeg = line.segments.find(
      (s) => s.x >= 80 && s.x < 140 && /^\w{3}\s+\d{1,2}$/.test(s.text.trim())
    );

    if (dateSeg) {
      if (currentTx) transactions.push(currentTx);

      const txBb: Record<string, BoundingBox> = {};
      const effDate = parseMonthDay(dateSeg.text, year);
      txBb.date = toBBox(dateSeg, line);

      // System date at x≈158
      const sysDateSeg = line.segments.find(
        (s) => s.x >= 140 && s.x < 200 && /^\w{3}\s+\d{1,2}$/.test(s.text.trim())
      );
      const sysDate = sysDateSeg ? parseMonthDay(sysDateSeg.text, year) : effDate;

      // Description at x≈201.5
      const descSegs = line.segments.filter((s) => s.x >= 195 && s.x < 480);
      const description = descSegs.map((s) => s.text).join(" ").trim();
      if (descSegs.length > 0) txBb.description = toBBox(descSegs[0], line);

      // Amount — could be split: "$" at x≈489.5 and number at x≈549+
      // Or just the number segment
      const amtSegs = line.segments.filter((s) => s.x >= 480);
      let amount = 0;
      if (amtSegs.length > 0) {
        const amtText = amtSegs.map((s) => s.text).join("").trim();
        // Remove "$" prefix if present
        const cleanAmt = amtText.replace(/^\$\s*/, "");
        amount = parseCurrency(cleanAmt) ?? 0;
        txBb.amount = toBBox(amtSegs[amtSegs.length - 1], line);
      }

      const type = DEPOSIT_SECTIONS.has(currentSection) ? "deposit" : "withdrawal";
      if (type === "withdrawal") amount = -amount;

      currentTx = {
        date: effDate,
        systemDate: sysDate,
        description,
        amount,
        type,
        category: currentSection,
        boundingBoxes: txBb,
      };
    } else if (currentTx) {
      // Continuation line — append to description
      const descSegs = line.segments.filter((s) => s.x >= 195 && s.x < 480);
      if (descSegs.length > 0) {
        const contText = descSegs.map((s) => s.text).join(" ").trim();
        if (contText) {
          currentTx.description += " " + contText;
        }
      }
    }
  }

  if (currentTx) transactions.push(currentTx);
  return transactions;
}
