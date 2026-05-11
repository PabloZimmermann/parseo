import { extractLines, parseCurrency, toBBox, UnrecognizedFormatError } from "@parseo/shared";
import type { TextLine, TextSegment, DateString, BoundingBox } from "@parseo/shared";
import type {
  CapitalOneStatement,
  AccountHolder,
  StatementSummary,
  Transaction,
} from "./types.js";

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

export async function parseCapitalOneStatement(buffer: Buffer): Promise<CapitalOneStatement> {
  const lines = await extractLines(buffer);
  return parseCapitalOneFromLines(lines);
}

export function parseCapitalOneFromLines(lines: TextLine[]): CapitalOneStatement {
  const head = lines.slice(0, 30).map((l) => l.fullText).join("\n");
  if (!/capital\s*one/i.test(head) && !/capitalone/i.test(head)) {
    throw new UnrecognizedFormatError(
      "CapitalOne",
      "first 30 lines do not contain a Capital One signature"
    );
  }

  const bb: Record<string, BoundingBox> = {};

  const accountHolder = parseAccountHolder(lines);
  const statementPeriod = parseStatementPeriod(lines);
  const { accountNumber, accountName } = parseAccountInfo(lines);
  const jointWith = parseJointWith(lines);
  const summary = parseSummary(lines, statementPeriod);
  const transactions = parseTransactions(lines, statementPeriod);

  let totalDeposits = 0;
  let totalWithdrawals = 0;
  for (const tx of transactions) {
    if (tx.amount > 0) totalDeposits += tx.amount;
    else totalWithdrawals += Math.abs(tx.amount);
  }

  return {
    accountHolder,
    accountNumber,
    accountName,
    jointWith,
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

  // Name and address are on page 1, x≈57, y 130-165
  let name = "";
  const addressParts: string[] = [];

  for (const line of page1) {
    if (line.y < 125 || line.y > 170) continue;
    const leftSegs = line.segments.filter((s) => s.x < 200);
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

// ── Statement period ──────────────────────────────────────────────────────

function parseStatementPeriod(
  lines: TextLine[],
): { start: DateString; end: DateString } {
  for (const line of lines) {
    // Format: "Jul 1 - Sep 30, 2024"
    const m = line.fullText.match(
      /([A-Z][a-z]+)\s+(\d{1,2})\s*-\s*([A-Z][a-z]+)\s+(\d{1,2}),?\s+(\d{4})/
    );
    if (m) {
      const startMonth = MONTHS[m[1]];
      const endMonth = MONTHS[m[3]];
      if (!startMonth || !endMonth) continue;

      const year = parseInt(m[5], 10);
      // If start month > end month, start is previous year
      const startYear = parseInt(startMonth, 10) > parseInt(endMonth, 10) ? year - 1 : year;

      return {
        start: `${startYear}-${startMonth}-${m[2].padStart(2, "0")}`,
        end: `${year}-${endMonth}-${m[4].padStart(2, "0")}`,
      };
    }
  }
  return { start: "", end: "" };
}

// ── Account info ──────────────────────────────────────────────────────────

function parseAccountInfo(lines: TextLine[]): { accountNumber: string; accountName: string } {
  for (const line of lines) {
    // "360 Performance Savings - 36245686307"
    const m = line.fullText.match(/^(.+?)\s*-\s*(\d{8,})$/);
    if (m) {
      return { accountName: m[1].trim(), accountNumber: m[2] };
    }
  }
  return { accountNumber: "", accountName: "" };
}

// ── Joint info ────────────────────────────────────────────────────────────

function parseJointWith(lines: TextLine[]): string | null {
  for (const line of lines) {
    const m = line.fullText.match(/JOINT WITH\s+(.+)/i);
    if (m) return m[1].trim();
  }
  return null;
}

// ── Summary ───────────────────────────────────────────────────────────────

function parseSummary(
  lines: TextLine[],
  period: { start: DateString; end: DateString },
): StatementSummary {
  const bb: Record<string, BoundingBox> = {};
  let openingBalance = 0;
  let closingBalance = 0;
  let interestEarned = 0;
  let totalFees = 0;
  let apy = 0;

  for (const line of lines) {
    const text = line.fullText;

    // Opening balance: "Opening Balance" line in transactions
    if (/Opening Balance/i.test(text)) {
      const valSeg = line.segments.find((s) => s.x > 450 && /\$/.test(s.text));
      if (valSeg) {
        openingBalance = parseCurrency(valSeg.text) ?? 0;
        bb.openingBalance = toBBox(valSeg, line);
      }
    }

    // Closing balance: "Closing Balance" line in transactions
    if (/Closing Balance/i.test(text) && !/Opening/.test(text)) {
      const valSeg = line.segments.find((s) => s.x > 450 && /\$/.test(s.text));
      if (valSeg) {
        closingBalance = parseCurrency(valSeg.text) ?? 0;
        bb.closingBalance = toBBox(valSeg, line);
      }
    }

    // Interest earned: "$340.90 INTEREST EARNED"
    if (/INTEREST EARNED/i.test(text)) {
      const valSeg = line.segments.find((s) => /\$[\d,.]+.*INTEREST/i.test(s.text));
      if (valSeg) {
        const im = valSeg.text.match(/\$([\d,.]+)/);
        if (im) {
          interestEarned = parseCurrency(im[1]) ?? 0;
          bb.interestEarned = toBBox(valSeg, line);
        }
      }
    }

    // Total fees: "Total Fees  $0.00  $0.00"
    if (/^Total Fees/i.test(text.trim())) {
      const valSeg = line.segments.find((s) => s.x > 100 && s.x < 250 && /\$/.test(s.text));
      if (valSeg) {
        totalFees = parseCurrency(valSeg.text) ?? 0;
        bb.totalFees = toBBox(valSeg, line);
      }
    }

    // APY: "4.23%"
    if (/ANNUAL PERCENTAGE YIELD/i.test(text)) {
      // APY value is on the line above
      const apyLine = lines.find(
        (l) => l.page === line.page && Math.abs(l.y - line.y) < 20 && l.y < line.y
      );
      if (apyLine) {
        const apySeg = apyLine.segments.find((s) => /\d+\.\d+%/.test(s.text));
        if (apySeg) {
          apy = parseFloat(apySeg.text.replace("%", ""));
          bb.apy = toBBox(apySeg, apyLine);
        }
      }
    }
  }

  return { openingBalance, closingBalance, interestEarned, totalFees, apy, boundingBoxes: bb };
}

// ── Transactions ──────────────────────────────────────────────────────────

interface RawTx {
  date: string;
  dateSeg: TextSegment;
  dateLine: TextLine;
  descParts: string[];
  descSeg: TextSegment | null;
  descLine: TextLine | null;
  category: string | null;
  categorySeg: TextSegment | null;
  categoryLine: TextLine | null;
  amountRaw: string | null;
  amountSeg: TextSegment | null;
  amountLine: TextLine | null;
  balanceRaw: string | null;
  balanceSeg: TextSegment | null;
  balanceLine: TextLine | null;
}

const DATE_RX = /^([A-Z][a-z]+)\s+(\d{1,2})$/;

function parseTransactions(
  lines: TextLine[],
  period: { start: DateString; end: DateString },
): Transaction[] {
  // Find transaction lines (pages with DATE/DESCRIPTION headers)
  const txPages = new Set<number>();
  for (const line of lines) {
    if (/^DATE$/.test(line.segments[0]?.text.trim() ?? "") && line.segments.some((s) => s.text.trim() === "DESCRIPTION")) {
      txPages.add(line.page);
    }
  }

  const txPageLines = lines.filter((l) => txPages.has(l.page));
  const endYear = parseInt(period.end?.slice(0, 4) ?? "2024", 10);

  // Collect raw transactions
  const rawTxs: RawTx[] = [];
  let pendingDesc: { text: string; seg: TextSegment; line: TextLine }[] = [];
  let current: RawTx | null = null;
  let pastHeader = false;

  for (const line of txPageLines) {
    // Skip header line
    if (line.segments.some((s) => s.text.trim() === "DESCRIPTION") && line.segments.some((s) => s.text.trim() === "DATE")) {
      pastHeader = true;
      continue;
    }
    if (!pastHeader) continue;

    // Stop at Fees Summary
    if (/Fees Summary/i.test(line.fullText)) break;

    const dateSeg = line.segments.find((s) => s.x < 80 && DATE_RX.test(s.text.trim()));
    const descSeg = line.segments.find((s) => s.x >= 90 && s.x < 300);
    const categorySeg = line.segments.find((s) => s.x >= 300 && s.x < 400 && /Credit|Debit/i.test(s.text.trim()));
    const amountSeg = line.segments.find((s) => s.x >= 390 && s.x < 480 && /[+-].*\$/.test(s.text));
    const balanceSeg = line.segments.find((s) => s.x >= 480 && /\$/.test(s.text));

    if (dateSeg) {
      // Save previous transaction
      if (current) rawTxs.push(current);

      current = {
        date: dateSeg.text.trim(),
        dateSeg,
        dateLine: line,
        descParts: pendingDesc.map((d) => d.text),
        descSeg: pendingDesc.length > 0 ? pendingDesc[0].seg : null,
        descLine: pendingDesc.length > 0 ? pendingDesc[0].line : null,
        category: categorySeg?.text.trim() ?? null,
        categorySeg: categorySeg ?? null,
        categoryLine: categorySeg ? line : null,
        amountRaw: amountSeg?.text.trim() ?? null,
        amountSeg: amountSeg ?? null,
        amountLine: amountSeg ? line : null,
        balanceRaw: balanceSeg?.text.trim() ?? null,
        balanceSeg: balanceSeg ?? null,
        balanceLine: balanceSeg ? line : null,
      };
      pendingDesc = [];

      if (descSeg) {
        current.descParts.push(descSeg.text.trim());
        if (!current.descSeg) {
          current.descSeg = descSeg;
          current.descLine = line;
        }
      }
    } else if (descSeg) {
      // Description-only line: attach to current tx if close (within ~12pt),
      // otherwise buffer for the next transaction's leading description.
      const isCloseToCurrentDate =
        current &&
        line.page === current.dateLine.page &&
        line.y - current.dateLine.y < 12;

      if (isCloseToCurrentDate) {
        current!.descParts.push(descSeg.text.trim());
        if (!current!.descSeg) {
          current!.descSeg = descSeg;
          current!.descLine = line;
        }
      } else {
        pendingDesc.push({ text: descSeg.text.trim(), seg: descSeg, line });
      }
    }
  }
  if (current) rawTxs.push(current);

  // Convert raw transactions to typed transactions
  const transactions: Transaction[] = [];

  for (const raw of rawTxs) {
    // Skip Opening/Closing Balance lines and info-only lines (no amount)
    if (!raw.amountRaw) continue;

    const txBb: Record<string, BoundingBox> = {};

    // Parse date: "Jul 31" → need year from statement period
    const dm = raw.date.match(DATE_RX);
    if (!dm) continue;
    const month = MONTHS[dm[1]];
    if (!month) continue;
    const day = dm[2].padStart(2, "0");

    // Determine year: if month is after end month, it's the previous year
    const endMonth = parseInt(period.end?.slice(5, 7) ?? "12", 10);
    const txMonth = parseInt(month, 10);
    const year = txMonth > endMonth ? endYear - 1 : endYear;
    const date: DateString = `${year}-${month}-${day}`;
    txBb.date = toBBox(raw.dateSeg, raw.dateLine);

    // Description
    const description = raw.descParts.join(" ").trim();
    if (raw.descSeg && raw.descLine) txBb.description = toBBox(raw.descSeg, raw.descLine);

    // Amount: "+ $108.95" or "- $500.00"
    const amtMatch = raw.amountRaw.match(/([+-])\s*\$([\d,.]+)/);
    if (!amtMatch) continue;
    const amtVal = parseCurrency(amtMatch[2]) ?? 0;
    const amount = amtMatch[1] === "+" ? amtVal : -amtVal;
    if (raw.amountSeg && raw.amountLine) txBb.amount = toBBox(raw.amountSeg, raw.amountLine);

    // Balance
    let balance = 0;
    if (raw.balanceRaw) {
      balance = parseCurrency(raw.balanceRaw) ?? 0;
      if (raw.balanceSeg && raw.balanceLine) txBb.balance = toBBox(raw.balanceSeg, raw.balanceLine);
    }

    // Category
    const category = raw.category ?? null;
    if (raw.categorySeg && raw.categoryLine) txBb.category = toBBox(raw.categorySeg, raw.categoryLine);

    transactions.push({ date, description, category, amount, balance, boundingBoxes: txBb });
  }

  return transactions;
}
