import { extractLines, parseCurrency, toBBox, UnrecognizedFormatError } from "@parseo/shared";
import type { TextLine, DateString, BoundingBox } from "@parseo/shared";
import type {
  NavyFederalStatement,
  AccountHolder,
  Account,
  AccountSummary,
  Transaction,
} from "./types.js";

export async function parseNavyFederalStatement(buffer: Buffer): Promise<NavyFederalStatement> {
  const lines = await extractLines(buffer);
  return parseNavyFederalFromLines(lines);
}

export function parseNavyFederalFromLines(lines: TextLine[]): NavyFederalStatement {
  const head = lines.slice(0, 30).map((l) => l.fullText).join("\n");
  if (!/Navy Federal/i.test(head) && !/navyfederal/i.test(head) && !/Statement of Account/i.test(head)) {
    throw new UnrecognizedFormatError(
      "NavyFederal",
      "first 30 lines do not contain a Navy Federal signature"
    );
  }

  const bb: Record<string, BoundingBox> = {};

  const accountHolder = parseAccountHolder(lines);

  const { accessNumber, bbox: accessBbox } = parseAccessNumber(lines);
  if (accessBbox) bb.accessNumber = accessBbox;

  const { statementPeriod, bbox: periodBbox } = parseStatementPeriod(lines);
  if (periodBbox) bb.statementPeriod = periodBbox;

  const year = statementPeriod.from?.slice(0, 4) ?? "";

  const summaryAccounts = parseSummaryTable(lines);
  const accounts = parseAccountTransactions(lines, summaryAccounts, year);

  let totalDeposits = 0;
  let totalWithdrawals = 0;
  for (const acct of accounts) {
    totalDeposits += acct.summary.depositsCredits;
    totalWithdrawals += acct.summary.withdrawalsDebits;
  }

  return {
    accountHolder,
    accessNumber,
    statementPeriod,
    accounts,
    totalDeposits,
    totalWithdrawals,
    boundingBoxes: bb,
  };
}

// ── Account holder ─────────────────────────────────────────────────────────

function parseAccountHolder(lines: TextLine[]): AccountHolder {
  const bb: Record<string, BoundingBox> = {};
  const parts: { text: string; line: TextLine; seg: import("@parseo/shared").TextSegment }[] = [];

  for (const line of lines) {
    if (line.page !== 1) break;
    // Account holder info is on the left side (x < 300), between y ~130 and ~180
    if (line.y < 130 || line.y > 180) continue;
    const leftSegs = line.segments.filter((s) => s.x < 300);
    if (leftSegs.length === 0) continue;
    const text = leftSegs.map((s) => s.text).join(" ").trim();
    if (!text) continue;
    // Skip coded/barcode lines
    if (/^#/.test(text)) continue;
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

// ── Access number ──────────────────────────────────────────────────────────

function parseAccessNumber(lines: TextLine[]): { accessNumber: string; bbox: BoundingBox | null } {
  for (const line of lines) {
    if (line.page > 1) break;
    const m = line.fullText.match(/Access\s*No\.\s*(\d+)/);
    if (m) {
      const seg = line.segments.find((s) => s.text.includes(m[1]));
      return { accessNumber: m[1], bbox: seg ? toBBox(seg, line) : null };
    }
  }
  return { accessNumber: "", bbox: null };
}

// ── Statement period ───────────────────────────────────────────────────────

function parseStatementPeriod(lines: TextLine[]): {
  statementPeriod: { from: DateString; to: DateString };
  bbox: BoundingBox | null;
} {
  for (const line of lines) {
    if (line.page > 1) break;
    const m = line.fullText.match(/(\d{2}\/\d{2}\/\d{2})\s*-\s*(\d{2}\/\d{2}\/\d{2})/);
    if (m) {
      const from = shortDateToISO(m[1]);
      const to = shortDateToISO(m[2]);
      return { statementPeriod: { from, to }, bbox: toBBox(line.segments[0], line) };
    }
  }
  return { statementPeriod: { from: null, to: null }, bbox: null };
}

function shortDateToISO(dateStr: string): DateString {
  const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (m) {
    const yy = parseInt(m[3], 10);
    const fullYear = yy >= 80 ? `19${m[3]}` : `20${m[3]}`;
    return `${fullYear}-${m[1]}-${m[2]}`;
  }
  return null;
}

function monthDayToISO(mmdd: string, year: string): DateString {
  const m = mmdd.match(/^(\d{2})-(\d{2})$/);
  if (m) return `${year}-${m[1]}-${m[2]}`;
  return null;
}

// ── Summary table ──────────────────────────────────────────────────────────

interface SummaryEntry {
  accountType: string;
  accountNumber: string;
  previousBalance: number;
  depositsCredits: number;
  withdrawalsDebits: number;
  endingBalance: number;
  ytdDividends: number;
  boundingBoxes: Record<string, BoundingBox>;
}

function parseSummaryTable(lines: TextLine[]): SummaryEntry[] {
  const entries: SummaryEntry[] = [];
  let inSummary = false;
  let pendingType = "";
  let pendingTypeBbox: BoundingBox | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = line.fullText.trim();

    if (/^Summary of your deposit accounts/i.test(text)) {
      inSummary = true;
      continue;
    }

    if (!inSummary) continue;

    // End of summary table
    if (/^Totals\b/i.test(text)) break;

    // Skip column headers
    if (/Previous\s+Deposits/i.test(text) || /Balance\s+Credits/i.test(text)) continue;

    // Account type line (no dollar amounts, just a label)
    if (line.segments.length === 1 && !text.match(/^\d/) && !text.startsWith("$")) {
      pendingType = text;
      pendingTypeBbox = toBBox(line.segments[0], line);
      continue;
    }

    // Account data line: starts with account number, followed by dollar amounts
    const firstSeg = line.segments[0];
    if (firstSeg && /^\d{5,}$/.test(firstSeg.text.trim())) {
      const bb: Record<string, BoundingBox> = {};
      if (pendingTypeBbox) bb.accountType = pendingTypeBbox;

      const accountNumber = firstSeg.text.trim();
      bb.accountNumber = toBBox(firstSeg, line);

      const amounts = line.segments
        .slice(1)
        .map((seg) => ({
          value: parseCurrency(seg.text),
          bbox: toBBox(seg, line),
        }))
        .filter((a) => a.value !== null);

      entries.push({
        accountType: pendingType,
        accountNumber,
        previousBalance: amounts[0]?.value ?? 0,
        depositsCredits: amounts[1]?.value ?? 0,
        withdrawalsDebits: amounts[2]?.value ?? 0,
        endingBalance: amounts[3]?.value ?? 0,
        ytdDividends: amounts[4]?.value ?? 0,
        boundingBoxes: bb,
      });

      if (amounts[0]) bb.previousBalance = amounts[0].bbox;
      if (amounts[1]) bb.depositsCredits = amounts[1].bbox;
      if (amounts[2]) bb.withdrawalsDebits = amounts[2].bbox;
      if (amounts[3]) bb.endingBalance = amounts[3].bbox;
      if (amounts[4]) bb.ytdDividends = amounts[4].bbox;

      pendingType = "";
      pendingTypeBbox = null;
    }
  }

  return entries;
}

// ── Account transactions ───────────────────────────────────────────────────

const AMOUNT_MIN_X = 400;
const BALANCE_MIN_X = 530;

function parseAccountTransactions(
  lines: TextLine[],
  summaryAccounts: SummaryEntry[],
  year: string,
): Account[] {
  // Build a map from accountNumber → SummaryEntry
  const summaryMap = new Map<string, SummaryEntry>();
  for (const entry of summaryAccounts) {
    summaryMap.set(entry.accountNumber, entry);
  }

  // Find all transaction sections: "AccountType - AccountNumber"
  const sections: { accountType: string; accountNumber: string; startIdx: number }[] = [];
  const sectionRx = /^(.+?)\s*-\s*(\d{5,})/;

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].fullText.trim();
    const m = text.match(sectionRx);
    if (m && summaryMap.has(m[2])) {
      sections.push({ accountType: m[1].trim(), accountNumber: m[2], startIdx: i });
    }
  }

  // Merge continued sections into a single account per account number
  const accountMap = new Map<string, Account>();
  const accountOrder: string[] = [];

  for (let s = 0; s < sections.length; s++) {
    const section = sections[s];
    const transactions = parseTransactionSection(lines, section.startIdx, year);

    const existing = accountMap.get(section.accountNumber);
    if (existing) {
      // Merge transactions from continuation page
      existing.transactions.push(...transactions);
    } else {
      const summaryEntry = summaryMap.get(section.accountNumber);

      const summary: AccountSummary = {
        previousBalance: summaryEntry?.previousBalance ?? 0,
        depositsCredits: summaryEntry?.depositsCredits ?? 0,
        withdrawalsDebits: summaryEntry?.withdrawalsDebits ?? 0,
        endingBalance: summaryEntry?.endingBalance ?? 0,
        ytdDividends: summaryEntry?.ytdDividends ?? 0,
        boundingBoxes: summaryEntry?.boundingBoxes ?? {},
      };

      const bb: Record<string, BoundingBox> = {};
      const headerSeg = lines[section.startIdx].segments[0];
      if (headerSeg) bb.sectionHeader = toBBox(headerSeg, lines[section.startIdx]);

      const account: Account = {
        accountType: section.accountType,
        accountNumber: section.accountNumber,
        summary,
        transactions,
        boundingBoxes: bb,
      };

      accountMap.set(section.accountNumber, account);
      accountOrder.push(section.accountNumber);
    }
  }

  return accountOrder.map((num) => accountMap.get(num)!);
}

function parseTransactionSection(lines: TextLine[], startIdx: number, year: string): Transaction[] {
  const transactions: Transaction[] = [];
  let i = startIdx + 1;

  // Skip column headers
  while (i < lines.length) {
    const text = lines[i].fullText.trim();
    if (/^Date\s+Transaction/i.test(text)) {
      i++;
      break;
    }
    i++;
    if (i - startIdx > 5) break; // safety
  }

  while (i < lines.length) {
    const line = lines[i];
    const text = line.fullText.trim();

    // End conditions
    if (/Ending Balance/i.test(text)) { i++; break; }
    if (/^No Transactions This Period/i.test(text)) { i++; break; }
    if (/Average Daily Balance/i.test(text)) break;
    if (/^Items Paid/i.test(text)) break;
    if (/^Savings$/i.test(text)) break;
    if (/^Checking$/i.test(text)) break;
    if (/^Disclosure/i.test(text)) break;
    // New section header
    if (/^.+\s*-\s*\d{5,}\s*($$Continued|$)/.test(text)) break;
    // Skip "Beginning Balance" — it's not a transaction
    if (/Beginning Balance/i.test(text)) { i++; continue; }
    // Skip noise
    if (/REMITTANCE RECEIVED/i.test(text)) { i++; continue; }
    if (/DEPOSIT VOUCHER/i.test(text)) break;

    const firstSeg = line.segments[0];
    if (!firstSeg) { i++; continue; }

    // Transaction line: first segment starts with "MM-DD "
    const dateMatch = firstSeg.text.trim().match(/^(\d{2}-\d{2})\s+(.+)/);
    if (dateMatch) {
      const bb: Record<string, BoundingBox> = {};
      const date = monthDayToISO(dateMatch[1], year);
      bb.date = toBBox(firstSeg, line);

      // Description from the first segment (after date)
      let description = dateMatch[2].trim();
      bb.description = toBBox(firstSeg, line);

      // Additional description segments before the amount column
      for (let s = 1; s < line.segments.length; s++) {
        const seg = line.segments[s];
        if (seg.x < AMOUNT_MIN_X) {
          description += " " + seg.text.trim();
        }
      }

      // Amount: segment at AMOUNT_MIN_X+, trailing "-" means debit
      let amount = 0;
      const amountSegs = line.segments.filter((seg) => seg.x >= AMOUNT_MIN_X && seg.x < BALANCE_MIN_X);
      if (amountSegs.length > 0) {
        const amtSeg = amountSegs[0];
        const amtText = amtSeg.text.trim();
        const isDebit = amtText.endsWith("-");
        const cleanAmt = amtText.replace(/-$/, "");
        const val = parseCurrency(cleanAmt);
        if (val !== null) {
          amount = isDebit ? -val : val;
          bb.amount = toBBox(amtSeg, line);
        }
      }

      // Balance: segment at BALANCE_MIN_X+
      let balance: number | null = null;
      const balSegs = line.segments.filter((seg) => seg.x >= BALANCE_MIN_X);
      if (balSegs.length > 0) {
        balance = parseCurrency(balSegs[0].text);
        if (balance !== null) bb.balance = toBBox(balSegs[0], line);
      }

      transactions.push({ date, description, amount, balance, boundingBoxes: bb });
    } else if (transactions.length > 0 && firstSeg.x > 30) {
      // Continuation line
      const descParts = line.segments
        .filter((seg) => seg.x < AMOUNT_MIN_X)
        .map((seg) => seg.text.trim())
        .filter(Boolean);
      if (descParts.length > 0) {
        transactions[transactions.length - 1].description += " " + descParts.join(" ");
      }
    }

    i++;
  }

  return transactions;
}
