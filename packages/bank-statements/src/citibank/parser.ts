import { extractLines, parseCurrency, toBBox, UnrecognizedFormatError } from "@parseo/shared";
import type { TextLine, DateString, BoundingBox } from "@parseo/shared";
import type {
  CitibankStatement,
  AccountHolder,
  Account,
  Transaction,
} from "./types.js";

export async function parseCitibankStatement(buffer: Buffer): Promise<CitibankStatement> {
  const lines = await extractLines(buffer);
  return parseCitibankFromLines(lines);
}

export function parseCitibankFromLines(lines: TextLine[]): CitibankStatement {
  const head = lines.slice(0, 30).map((l) => l.fullText).join("\n");
  if (!/Citibank/i.test(head) && !/CitiBusiness/i.test(head) && !/CITIBANK/i.test(head)) {
    throw new UnrecognizedFormatError(
      "Citibank",
      "first 30 lines do not contain a Citibank signature"
    );
  }

  const bb: Record<string, BoundingBox> = {};

  const accountHolder = parseAccountHolder(lines);
  const { statementPeriod, bbox: periodBbox } = parseStatementPeriod(lines);
  if (periodBbox) bb.statementPeriod = periodBbox;

  const year = statementPeriod.from?.slice(0, 4) ?? "";

  const accounts = parseAccounts(lines, year);

  let totalDeposits = 0;
  let totalWithdrawals = 0;
  for (const acct of accounts) {
    totalDeposits += acct.totalCredits;
    totalWithdrawals += acct.totalDebits;
  }

  return {
    accountHolder,
    statementPeriod,
    accounts,
    totalDeposits,
    totalWithdrawals,
    boundingBoxes: bb,
  };
}

// ── Months ────────────────────────────────────────────────────────────────

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04",
  may: "05", jun: "06", jul: "07", aug: "08",
  sep: "09", oct: "10", nov: "11", dec: "12",
  january: "01", february: "02", march: "03", april: "04",
  june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
};

// ── Account holder ────────────────────────────────────────────────────────

function parseAccountHolder(lines: TextLine[]): AccountHolder {
  const bb: Record<string, BoundingBox> = {};
  const nameParts: string[] = [];
  const addrParts: string[] = [];
  let foundName = false;

  for (const line of lines) {
    if (line.page !== 1) break;

    // Account holder block: left side (x≈122), y between ~95 and ~130
    if (line.y < 95 || line.y > 135) continue;
    const leftSegs = line.segments.filter((s) => s.x < 400 && s.x >= 100);
    if (leftSegs.length === 0) continue;
    const text = leftSegs.map((s) => s.text).join(" ").trim();
    if (!text) continue;

    if (!foundName) {
      // First line is name
      nameParts.push(text);
      bb.name = toBBox(leftSegs[0], line);
      foundName = true;
    } else if (/^DBA\b/i.test(text)) {
      // DBA line is part of name
      nameParts.push(text);
    } else {
      // Address lines
      addrParts.push(text);
      if (!bb.address) bb.address = toBBox(leftSegs[0], line);
    }
  }

  return {
    name: nameParts.join(" "),
    address: addrParts.join(", "),
    boundingBoxes: bb,
  };
}

// ── Statement period ──────────────────────────────────────────────────────

function parseStatementPeriod(lines: TextLine[]): {
  statementPeriod: { from: DateString; to: DateString };
  bbox: BoundingBox | null;
} {
  // Look for "Jan 1 - Jan 31, 2026" or "Statement Period: ..."
  const rx = /(\w+)\s+(\d{1,2})\s*-\s*(\w+)\s+(\d{1,2}),\s*(\d{4})/;
  for (const line of lines) {
    if (line.page > 2) break;
    const m = line.fullText.match(rx);
    if (m) {
      const mm1 = MONTHS[m[1].toLowerCase()];
      const mm2 = MONTHS[m[3].toLowerCase()];
      if (mm1 && mm2) {
        const from: DateString = `${m[5]}-${mm1}-${m[2].padStart(2, "0")}`;
        const to: DateString = `${m[5]}-${mm2}-${m[4].padStart(2, "0")}`;
        const seg = line.segments.find((s) => rx.test(s.text));
        return { statementPeriod: { from, to }, bbox: seg ? toBBox(seg, line) : null };
      }
    }
  }
  return { statementPeriod: { from: null, to: null }, bbox: null };
}

// ── Parse amount with trailing "-" ────────────────────────────────────────

function parseAmt(text: string): number | null {
  const cleaned = text.trim();
  const isNeg = cleaned.endsWith("-");
  const stripped = cleaned.replace(/-$/, "");
  const val = parseCurrency(stripped);
  if (val === null) return null;
  return isNeg ? -val : val;
}

// ── Accounts ──────────────────────────────────────────────────────────────

const DEBIT_MIN_X = 350;
const CREDIT_MIN_X = 430;
const BALANCE_MIN_X = 510;

function parseAccounts(lines: TextLine[], year: string): Account[] {
  // Find section headers: "CHECKING ACTIVITY" or "SAVINGS ACTIVITY"
  const sections: { type: string; startIdx: number; continued: boolean }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].fullText.trim();
    const m = text.match(/^(CHECKING ACTIVITY|SAVINGS ACTIVITY)/i);
    if (m) {
      const continued = /Continued/i.test(text);
      sections.push({ type: m[1], startIdx: i, continued });
    }
  }

  // Group sections by type (merge continuations)
  const accountMap = new Map<string, Account>();
  const accountOrder: string[] = [];
  // Track which account key each section type maps to
  const keyForType = new Map<string, string>();

  for (const section of sections) {
    if (section.continued) {
      // Continuation — merge into the existing account for this section type
      const key = keyForType.get(section.type);
      if (key && accountMap.has(key)) {
        const txns = parseTransactionSection(lines, section.startIdx, year);
        accountMap.get(key)!.transactions.push(...txns);
      }
    } else {
      const { accountType, accountNumber, beginningBalance, endingBalance, bb: acctBb } =
        parseAccountHeader(lines, section.startIdx);

      const key = accountNumber || section.type;
      keyForType.set(section.type, key);

      const txns = parseTransactionSection(lines, section.startIdx, year);

      const account: Account = {
        accountType,
        accountNumber,
        beginningBalance,
        endingBalance,
        totalDebits: 0,
        totalCredits: 0,
        transactions: txns,
        boundingBoxes: acctBb,
      };

      accountMap.set(key, account);
      if (!accountOrder.includes(key)) accountOrder.push(key);
    }
  }

  // Find Total Debits/Credits lines and assign to the correct account
  let currentSectionType = "";
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].fullText.trim();
    const sectionMatch = text.match(/^(CHECKING ACTIVITY|SAVINGS ACTIVITY)/i);
    if (sectionMatch) {
      currentSectionType = sectionMatch[1];
    }
    if (/^Total Debits\/Credits/i.test(text) && currentSectionType) {
      const key = keyForType.get(currentSectionType);
      if (key && accountMap.has(key)) {
        const segs = lines[i].segments.filter((s) => s.x >= DEBIT_MIN_X);
        const debits = segs[0] ? (parseCurrency(segs[0].text) ?? 0) : 0;
        const credits = segs[1] ? (parseCurrency(segs[1].text) ?? 0) : 0;
        accountMap.get(key)!.totalDebits = debits;
        accountMap.get(key)!.totalCredits = credits;
      }
    }
  }

  return accountOrder.map((key) => accountMap.get(key)!);
}

function parseAccountHeader(
  lines: TextLine[],
  startIdx: number,
): {
  accountType: string;
  accountNumber: string;
  beginningBalance: number;
  endingBalance: number;
  bb: Record<string, BoundingBox>;
} {
  const bb: Record<string, BoundingBox> = {};
  let accountType = "";
  let accountNumber = "";
  let beginningBalance = 0;
  let endingBalance = 0;

  // Look in the next ~10 lines for account info
  for (let i = startIdx + 1; i < Math.min(startIdx + 15, lines.length); i++) {
    const line = lines[i];
    const text = line.fullText.trim();

    // Column header line — stop looking for account details
    if (/^Date Description/i.test(text)) break;

    // Account type line (single label, no numbers)
    if (!accountType && line.segments.length <= 2 && !/^\d/.test(text) && !/Beginning/i.test(text)) {
      accountType = text;
      bb.accountType = toBBox(line.segments[0], line);
      continue;
    }

    // Account number + Beginning Balance: "9154391091  Beginning Balance:  $183.16-"
    const begM = text.match(/^(\d{5,})\s+Beginning Balance:\s*(.+)/i);
    if (begM) {
      accountNumber = begM[1];
      bb.accountNumber = toBBox(line.segments[0], line);
      beginningBalance = parseAmt(begM[2]) ?? 0;
      const balSeg = line.segments.find((s) => /\$/.test(s.text) || parseCurrency(s.text) !== null);
      if (balSeg) bb.beginningBalance = toBBox(balSeg, line);
      continue;
    }

    // Ending Balance line
    const endM = text.match(/Ending Balance:\s*(.+)/i);
    if (endM) {
      endingBalance = parseAmt(endM[1]) ?? 0;
      const balSeg = line.segments.find((s) => /\$/.test(s.text) || parseCurrency(s.text) !== null);
      if (balSeg) bb.endingBalance = toBBox(balSeg, line);
      continue;
    }
  }

  return { accountType, accountNumber, beginningBalance, endingBalance, bb };
}

function parseTransactionSection(lines: TextLine[], startIdx: number, year: string): Transaction[] {
  const transactions: Transaction[] = [];

  // Find column headers
  let i = startIdx + 1;
  while (i < lines.length) {
    if (/^Date Description/i.test(lines[i].fullText.trim())) {
      i++;
      break;
    }
    i++;
    if (i - startIdx > 15) break;
  }

  while (i < lines.length) {
    const line = lines[i];
    const text = line.fullText.trim();

    // End conditions
    if (/^Total Debits\/Credits/i.test(text)) break;
    if (/^(CHECKING ACTIVITY|SAVINGS ACTIVITY)/i.test(text)) break;
    if (/^Interest earned year to date/i.test(text)) break;
    if (/^Your CitiBusiness/i.test(text)) break;
    if (/^CUSTOMER SERVICE/i.test(text)) break;

    // Skip page headers on continuation pages
    if (/^Page \d+ of \d+/i.test(text)) { i++; continue; }
    if (/^AEBP|^DBA /i.test(text)) { i++; continue; }
    if (/^Account \d+/i.test(text)) { i++; continue; }
    if (/^Statement Period/i.test(text)) { i++; continue; }
    if (/^\d{3}\/R\d+\//i.test(text)) { i++; continue; }

    const firstSeg = line.segments[0];
    if (!firstSeg) { i++; continue; }

    // Transaction line: first segment starts with "MM/DD "
    const dateMatch = firstSeg.text.trim().match(/^(\d{2})\/(\d{2})\s+(.+)/);
    if (dateMatch) {
      const bb: Record<string, BoundingBox> = {};
      const date: DateString = `${year}-${dateMatch[1]}-${dateMatch[2]}`;
      bb.date = toBBox(firstSeg, line);

      // Description from first segment (after date) + additional desc segments
      let description = dateMatch[3].trim();
      bb.description = toBBox(firstSeg, line);

      for (let s = 1; s < line.segments.length; s++) {
        const seg = line.segments[s];
        if (seg.x < DEBIT_MIN_X) {
          description += " " + seg.text.trim();
        }
      }

      // Debit: segment at x >= 350 and < 430
      let debit: number | null = null;
      const debitSegs = line.segments.filter((s) => s.x >= DEBIT_MIN_X && s.x < CREDIT_MIN_X);
      if (debitSegs.length > 0) {
        debit = parseAmt(debitSegs[0].text);
        if (debit !== null) bb.debit = toBBox(debitSegs[0], line);
      }

      // Credit: segment at x >= 430 and < 510
      let credit: number | null = null;
      const creditSegs = line.segments.filter((s) => s.x >= CREDIT_MIN_X && s.x < BALANCE_MIN_X);
      if (creditSegs.length > 0) {
        credit = parseAmt(creditSegs[0].text);
        if (credit !== null) bb.credit = toBBox(creditSegs[0], line);
      }

      // Balance: segment at x >= 510
      let balance: number | null = null;
      const balSegs = line.segments.filter((s) => s.x >= BALANCE_MIN_X);
      if (balSegs.length > 0) {
        balance = parseAmt(balSegs[0].text);
        if (balance !== null) bb.balance = toBBox(balSegs[0], line);
      }

      transactions.push({ date, description, debit, credit, balance, boundingBoxes: bb });
    } else if (transactions.length > 0 && firstSeg.x > 60) {
      // Continuation line (indented, at x≈75)
      const descParts = line.segments
        .filter((seg) => seg.x < DEBIT_MIN_X)
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
