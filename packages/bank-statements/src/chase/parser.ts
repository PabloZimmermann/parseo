import { extractLines, parseCurrency, parseNum, toBBox, UnrecognizedFormatError, MissingSectionError } from "@parseo/shared";
import type { TextLine, DateString, BoundingBox } from "@parseo/shared";
import type { ChaseStatement, AccountHolder, CheckingSummary, SummaryLine, Transaction, DailyBalance } from "./types.js";

export async function parseChaseStatement(buffer: Buffer): Promise<ChaseStatement> {
  const lines = await extractLines(buffer);
  return parseChaseFromLines(lines);
}

export function parseChaseFromLines(lines: TextLine[]): ChaseStatement {
  // Filter out Chase internal markers (*start*, *end*)
  const filtered = lines.filter((l) => !l.fullText.startsWith("*start*") && !l.fullText.startsWith("*end*"));

  const head = filtered.slice(0, 30).map((l) => l.fullText).join("\n");
  if (!/Chase/i.test(head) && !/JPMorgan/i.test(head)) {
    throw new UnrecognizedFormatError(
      "Chase",
      "first 30 lines do not contain a Chase / JPMorgan signature"
    );
  }

  const bb: Record<string, BoundingBox> = {};

  const { accountType, bbox: accountTypeBbox } = parseAccountType(filtered);
  if (accountTypeBbox) bb.accountType = accountTypeBbox;

  const { statementPeriod, bbox: periodBbox } = parseStatementPeriod(filtered);
  if (periodBbox) bb.statementPeriod = periodBbox;

  const year = statementPeriod.from?.slice(0, 4) ?? "";
  const accountHolder = parseAccountHolder(filtered);

  const { accountNumber, bbox: accountNumberBbox } = parseAccountNumber(filtered);
  if (accountNumberBbox) bb.accountNumber = accountNumberBbox;

  const summary = parseSummary(filtered);
  const transactions = parseTransactions(filtered, year);
  const dailyEndingBalances = parseDailyEndingBalances(filtered, year);

  return {
    accountHolder,
    accountNumber,
    accountType,
    statementPeriod,
    summary,
    transactions,
    dailyEndingBalances,
    boundingBoxes: bb,
  };
}

// ── Month helpers ───────────────────────────────────────────────────────────

const MONTHS: Record<string, string> = {
  January: "01", February: "02", March: "03", April: "04",
  May: "05", June: "06", July: "07", August: "08",
  September: "09", October: "10", November: "11", December: "12",
};

function fullDateToISO(raw: string): DateString {
  const m = raw.trim().match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${MONTHS[m[1]]}-${m[2].padStart(2, "0")}`;
}

function shortDateToISO(shortDate: string, year: string): DateString {
  const parts = shortDate.split("/");
  if (parts.length === 2) {
    return `${year}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
  }
  return null;
}

// ── Statement period ────────────────────────────────────────────────────────

function parseStatementPeriod(lines: TextLine[]): { statementPeriod: { from: DateString; to: DateString }; bbox: BoundingBox | null } {
  for (const line of lines.slice(0, 10)) {
    // "January 01, 2026 through January 30, 2026"
    const m = line.fullText.match(
      /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\s+through\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/
    );
    if (m) {
      const from = `${m[3]}-${MONTHS[m[1]]}-${m[2].padStart(2, "0")}`;
      const to = `${m[6]}-${MONTHS[m[4]]}-${m[5].padStart(2, "0")}`;
      const seg = line.segments.find((s) => s.text.includes(m[1]));
      return { statementPeriod: { from, to }, bbox: seg ? toBBox(seg, line) : null };
    }
  }
  return { statementPeriod: { from: null, to: null }, bbox: null };
}

// ── Account type ────────────────────────────────────────────────────────────

function parseAccountType(lines: TextLine[]): { accountType: string; bbox: BoundingBox | null } {
  for (const line of lines) {
    if (line.page !== 1) break;
    const text = line.fullText.trim();
    // "Chase Business Complete Checking", "Chase Total Checking", etc.
    if (/^Chase\s+(Business|Total|Premier|Secure|Sapphire)/i.test(text)) {
      return { accountType: text, bbox: toBBox(line.segments[0], line) };
    }
  }
  return { accountType: "", bbox: null };
}

// ── Account holder ──────────────────────────────────────────────────────────

function parseAccountHolder(lines: TextLine[]): AccountHolder {
  const bb: Record<string, BoundingBox> = {};
  let name = "";
  const addressParts: string[] = [];

  for (const line of lines) {
    if (line.page !== 1) break;
    if (line.y > 200) break;

    const leftSegs = line.segments.filter((s) => s.x < 300);
    if (leftSegs.length === 0) continue;
    const text = leftSegs.map((s) => s.text).join(" ").trim();

    if (!text) continue;
    // Skip non-address content
    if (/JPMorgan|P\s*O\s*Box|Columbus|DUPLICATE|CUSTOMER|Web site|Service Center|Para Espanol|International|relay|Chase\.com|^\d{5,}.*DRE|STATEMENT OF ACCOUNT|^SM$|^®$/i.test(text)) continue;

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
  for (const line of lines.slice(0, 15)) {
    const m = line.fullText.match(/Account\s*Number:\s*(\d+)/);
    if (m) {
      const seg = line.segments.find((s) => s.text.includes(m[1]));
      return { accountNumber: m[1], bbox: seg ? toBBox(seg, line) : null };
    }
  }
  return { accountNumber: "", bbox: null };
}

// ── Summary ─────────────────────────────────────────────────────────────────

function parseSummary(lines: TextLine[]): CheckingSummary {
  const bb: Record<string, BoundingBox> = {};
  let beginningBalance = 0;
  let endingBalance = 0;
  let depositsAndAdditions: SummaryLine = { instances: 0, amount: 0 };
  let checksPaid: SummaryLine = { instances: 0, amount: 0 };
  let atmDebitCardWithdrawals: SummaryLine = { instances: 0, amount: 0 };
  let electronicWithdrawals: SummaryLine = { instances: 0, amount: 0 };
  let fees: SummaryLine = { instances: 0, amount: 0 };

  let inSummary = false;

  for (const line of lines) {
    if (line.page > 1) break;
    const text = line.fullText;

    if (/^CHECKING SUMMARY/i.test(text)) { inSummary = true; continue; }
    if (!inSummary) continue;
    // Break at the actual section header (no numbers after it) or post-summary text
    if (/^DEPOSITS AND ADDITIONS\s*$/i.test(text) || /^Your Monthly Service Fee/i.test(text)) break;

    if (/^Beginning Balance/i.test(text)) {
      const amtSeg = line.segments.find((s) => /\$[\d,]+/.test(s.text));
      beginningBalance = amtSeg ? parseCurrency(amtSeg.text) ?? 0 : 0;
      if (amtSeg) bb.beginningBalance = toBBox(amtSeg, line);
    } else if (/^Ending Balance/i.test(text)) {
      // Last numeric segment is the balance (skip the instances count)
      const numSegs = line.segments.filter((s, idx) => idx > 0 && parseCurrency(s.text) !== null);
      const amtSeg = numSegs[numSegs.length - 1];
      endingBalance = amtSeg ? parseCurrency(amtSeg.text) ?? 0 : 0;
      if (amtSeg) bb.endingBalance = toBBox(amtSeg, line);
    } else if (/^Deposits and Additions/i.test(text)) {
      depositsAndAdditions = parseSummaryLine(line);
    } else if (/^Checks Paid/i.test(text)) {
      checksPaid = parseSummaryLine(line);
    } else if (/^ATM & Debit Card/i.test(text)) {
      atmDebitCardWithdrawals = parseSummaryLine(line);
    } else if (/^Electronic Withdrawals/i.test(text)) {
      electronicWithdrawals = parseSummaryLine(line);
    } else if (/^Fees\b/i.test(text)) {
      fees = parseSummaryLine(line);
    }
  }

  return {
    beginningBalance, endingBalance,
    depositsAndAdditions, checksPaid, atmDebitCardWithdrawals, electronicWithdrawals, fees,
    boundingBoxes: bb,
  };
}

function parseSummaryLine(line: TextLine): SummaryLine {
  // Segments: [label] [instances] [amount]
  const segs = line.segments;
  let instances = 0;
  let amount = 0;

  for (let i = 1; i < segs.length; i++) {
    const text = segs[i].text.trim();
    const val = parseCurrency(text);
    if (val !== null) {
      // If we haven't found instances yet, this might be instances (small integer)
      if (instances === 0 && /^\d{1,3}$/.test(text)) {
        instances = parseInt(text, 10);
      } else {
        amount = val;
      }
    }
  }

  return { instances, amount };
}

// ── Transactions ────────────────────────────────────────────────────────────

// Section headers that define transaction categories
const SECTION_HEADERS: { pattern: RegExp; category: string }[] = [
  { pattern: /^DEPOSITS AND ADDITIONS/i, category: "Deposits and Additions" },
  { pattern: /^CHECKS PAID/i, category: "Checks Paid" },
  { pattern: /^ATM & DEBIT CARD WITHDRAWALS/i, category: "ATM & Debit Card Withdrawals" },
  { pattern: /^ELECTRONIC WITHDRAWALS/i, category: "Electronic Withdrawals" },
  { pattern: /^FEES$/i, category: "Fees" },
];

const AMOUNT_MIN_X = 480;

function parseTransactions(lines: TextLine[], year: string): Transaction[] {
  const transactions: Transaction[] = [];
  let currentCategory = "";
  let current: Transaction | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = line.fullText;

    // Check for section header
    const sectionMatch = SECTION_HEADERS.find((s) => s.pattern.test(text));
    if (sectionMatch) {
      if (current) { transactions.push(current); current = null; }
      currentCategory = sectionMatch.category;
      continue;
    }

    // Stop at daily ending balance or disclosures
    if (/^DAILY ENDING BALANCE/i.test(text)) break;
    if (/^IN CASE OF ERRORS/i.test(text)) break;
    if (/^ATM & DEBIT CARD SUMMARY/i.test(text)) {
      if (current) { transactions.push(current); current = null; }
      currentCategory = "";
      continue;
    }
    if (/^ATM & DEBIT CARD TOTALS/i.test(text)) continue;

    if (!currentCategory) continue;

    // Skip header lines, totals, page headers, disclaimers
    if (/^(DATE|CHECK NO\.|INSTANCES|AMOUNT|PAID)/i.test(text)) continue;
    if (/^Total /i.test(text)) { if (current) { transactions.push(current); current = null; } continue; }
    if (/^Page \d/i.test(text)) continue;
    if (/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d.*through/i.test(text)) continue;
    if (/^Account Number:/i.test(text)) continue;
    if (/^\(continued\)/i.test(text)) continue;
    if (/^If you see a description|^\^ An image/i.test(text)) continue;
    if (/^000\d+$/i.test(text)) continue;
    // Skip card holder summary lines
    if (/^(Jose|David|ATM & Debit Card Totals)/i.test(text) && /Card \d+/i.test(text)) continue;
    if (/^Total (ATM|Card)/i.test(text)) continue;

    // Check if this is a transaction line (starts with MM/DD)
    if (isChaseTransactionLine(line)) {
      if (current) transactions.push(current);
      current = buildChaseTransaction(line, year, currentCategory);
    } else if (current && isChaseContinuationLine(line)) {
      const descText = line.segments
        .filter((s) => s.x < AMOUNT_MIN_X)
        .map((s) => s.text.trim())
        .join(" ");
      if (descText) current.description += " " + descText;
    }
  }

  if (current) transactions.push(current);
  return transactions;
}

function isChaseTransactionLine(line: TextLine): boolean {
  // Chase transaction lines start with MM/DD either as own segment or merged with description
  const firstSeg = line.segments[0];
  if (!firstSeg) return false;
  const text = firstSeg.text.trim();
  // Standalone date segment
  if (/^\d{1,2}\/\d{1,2}$/.test(text) && firstSeg.x < 80) return true;
  // Merged: "01/02 Card Purchase..." or "1035 ^" (check number)
  if (/^\d{1,2}\/\d{1,2}\s+/.test(text) && firstSeg.x < 80) return true;
  // Check paid line: "1035 ^"
  if (/^\d{3,4}\s+\^?/.test(text) && firstSeg.x < 80) return true;
  return false;
}

function isChaseContinuationLine(line: TextLine): boolean {
  const firstSeg = line.segments[0];
  if (!firstSeg) return false;
  // Continuation at description column x ≈ 84-86
  return firstSeg.x >= 70 && firstSeg.x <= 250 && !/^\d{1,2}\/\d{1,2}/.test(firstSeg.text.trim());
}

function buildChaseTransaction(line: TextLine, year: string, category: string): Transaction {
  const bb: Record<string, BoundingBox> = {};
  const firstSeg = line.segments[0];
  const firstText = firstSeg.text.trim();

  let date: DateString = null;
  let descParts: string[] = [];
  let amount = 0;
  let startSegIdx = 0;

  // Handle checks paid: "1035 ^  01/13  $1,200.00"
  if (category === "Checks Paid" && /^\d{3,4}/.test(firstText)) {
    descParts.push(firstText.replace(/\s*\^?\s*$/, ""));
    bb.date = toBBox(firstSeg, line);
    // Find date in later segments
    for (let s = 1; s < line.segments.length; s++) {
      const seg = line.segments[s];
      if (/^\d{1,2}\/\d{1,2}$/.test(seg.text.trim())) {
        date = shortDateToISO(seg.text.trim(), year);
        startSegIdx = s + 1;
        break;
      }
    }
  } else if (/^\d{1,2}\/\d{1,2}$/.test(firstText)) {
    // Standalone date segment
    date = shortDateToISO(firstText, year);
    bb.date = toBBox(firstSeg, line);
    startSegIdx = 1;
  } else if (/^\d{1,2}\/\d{1,2}\s+/.test(firstText)) {
    // Merged date + description
    const dateMatch = firstText.match(/^(\d{1,2}\/\d{1,2})\s+(.*)$/);
    if (dateMatch) {
      date = shortDateToISO(dateMatch[1], year);
      bb.date = toBBox(firstSeg, line);
      descParts.push(dateMatch[2]);
    }
    startSegIdx = 1;
  }

  // Process remaining segments
  for (let s = startSegIdx; s < line.segments.length; s++) {
    const seg = line.segments[s];
    const text = seg.text.trim();

    if (seg.x >= AMOUNT_MIN_X) {
      const val = parseCurrency(text);
      if (val !== null) {
        amount = val;
        bb.amount = toBBox(seg, line);
      }
    } else {
      descParts.push(text);
      if (!bb.description) bb.description = toBBox(seg, line);
    }
  }

  return {
    date,
    description: descParts.join(" ").trim(),
    amount,
    category,
    boundingBoxes: bb,
  };
}

// ── Daily Ending Balances ───────────────────────────────────────────────────

function parseDailyEndingBalances(lines: TextLine[], year: string): DailyBalance[] {
  const balances: DailyBalance[] = [];
  let inSection = false;

  for (const line of lines) {
    const text = line.fullText;

    if (/^DAILY ENDING BALANCE/i.test(text)) { inSection = true; continue; }
    if (!inSection) continue;
    if (/^IN CASE OF ERRORS/i.test(text)) break;
    if (/^(DATE|AMOUNT)$/i.test(text.trim())) continue;
    if (/^Page \d/i.test(text)) continue;

    // Daily balance lines have multiple date/amount pairs on one line
    // "01/02 $8,639.83 01/13 1,182.31 01/23 3,976.39"
    for (const seg of line.segments) {
      const text = seg.text.trim();
      const m = text.match(/^(\d{1,2}\/\d{1,2})$/);
      if (m) {
        // Next segment should be the amount — find it
        const segIdx = line.segments.indexOf(seg);
        if (segIdx + 1 < line.segments.length) {
          const amtText = line.segments[segIdx + 1].text.trim();
          const val = parseCurrency(amtText);
          if (val !== null) {
            balances.push({ date: shortDateToISO(m[1], year), balance: val });
          }
        }
      }
    }

    // Also handle case where date and amount are in same segment
    const pairs = text.matchAll(/(\d{1,2}\/\d{1,2})\s+\$?([\d,]+\.\d{2})/g);
    for (const pair of pairs) {
      const d = shortDateToISO(pair[1], year);
      const v = parseCurrency(pair[2]);
      if (d && v !== null && !balances.some((b) => b.date === d)) {
        balances.push({ date: d, balance: v });
      }
    }
  }

  return balances.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
}
