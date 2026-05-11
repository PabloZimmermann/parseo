import { extractLines, parseCurrency, toBBox, UnrecognizedFormatError } from "@parseo/shared";
import type { TextLine, DateString, BoundingBox } from "@parseo/shared";
import type {
  RelayStatement,
  AccountHolder,
  StatementSummary,
  Transaction,
} from "./types.js";

export async function parseRelayStatement(buffer: Buffer): Promise<RelayStatement> {
  const lines = await extractLines(buffer);
  return parseRelayFromLines(lines);
}

export function parseRelayFromLines(lines: TextLine[]): RelayStatement {
  const head = lines.slice(0, 30).map((l) => l.fullText).join("\n");
  if (!/relayfi\.com/i.test(head) && !/Relay Financials/i.test(head) && !/Thread Bank/i.test(head)) {
    // Check footer on page 1 too
    const all = lines.map((l) => l.fullText).join("\n");
    if (!/relayfi\.com/i.test(all) && !/Relay Financials/i.test(all)) {
      throw new UnrecognizedFormatError(
        "Relay",
        "document does not contain a Relay signature"
      );
    }
  }

  const bb: Record<string, BoundingBox> = {};

  const accountHolder = parseAccountHolder(lines);
  const accountNumber = parseAccountNumber(lines);
  const accountName = parseAccountName(lines);
  const { statementPeriod, bbox: periodBbox } = parseStatementPeriod(lines);
  if (periodBbox) bb.statementPeriod = periodBbox;

  const summary = parseSummary(lines);
  const transactions = parseTransactions(lines);

  return {
    accountHolder,
    accountNumber,
    accountName,
    statementPeriod,
    summary,
    totalDeposits: summary.deposits,
    totalWithdrawals: summary.withdrawals,
    transactions,
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

function longDateToISO(text: string): DateString {
  const m = text.match(/(\w+)\s+(\d{1,2}),?\s*(\d{4})/);
  if (!m) return null;
  const mm = MONTHS[m[1].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[2].padStart(2, "0")}`;
}

// ── Account holder ────────────────────────────────────────────────────────

function parseAccountHolder(lines: TextLine[]): AccountHolder {
  const bb: Record<string, BoundingBox> = {};

  for (const line of lines) {
    if (line.page > 1) break;
    const m = line.fullText.match(/^Owners?:\s*(.+)/i);
    if (m) {
      bb.name = toBBox(line.segments[0], line);
      return { name: m[1].trim(), boundingBoxes: bb };
    }
  }

  return { name: "", boundingBoxes: bb };
}

// ── Account number ────────────────────────────────────────────────────────

function parseAccountNumber(lines: TextLine[]): string {
  for (const line of lines) {
    if (line.page > 1) break;
    const m = line.fullText.match(/Account\s*Number:\s*(.+)/i);
    if (m) return m[1].trim();
  }
  return "";
}

// ── Account name ──────────────────────────────────────────────────────────

function parseAccountName(lines: TextLine[]): string {
  // First line on page 1, typically the account label (e.g., "Flip Expenses")
  for (const line of lines) {
    if (line.page > 1) break;
    if (line.y < 80 && line.segments[0]?.x < 200) {
      const text = line.fullText.trim();
      if (text && !/Account\s*(Number|Statement)/i.test(text) && !/Routing/i.test(text)) {
        return text;
      }
    }
  }
  return "";
}

// ── Statement period ──────────────────────────────────────────────────────

function parseStatementPeriod(lines: TextLine[]): {
  statementPeriod: { from: DateString; to: DateString };
  bbox: BoundingBox | null;
} {
  // "THRS Solutions LLC | Dec 1 - Dec 31, 2025"
  const rx = /(\w+)\s+(\d{1,2})\s*-\s*(\w+)\s+(\d{1,2}),\s*(\d{4})/;
  for (const line of lines) {
    if (line.page > 1) break;
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

// ── Summary ───────────────────────────────────────────────────────────────

function parseSummary(lines: TextLine[]): StatementSummary {
  const bb: Record<string, BoundingBox> = {};
  let openingBalance = 0;
  let closingBalance = 0;
  let deposits = 0;
  let withdrawals = 0;

  for (const line of lines) {
    if (line.page > 1) break;

    // Look for the summary values line (contains "$" amounts after "SUMMARY")
    const segs = line.segments;
    if (segs.length < 2) continue;

    // The summary values line has opening balance at x≈33, closing at x≈113
    const firstVal = parseCurrency(segs[0]?.text);
    const secondVal = parseCurrency(segs[1]?.text);
    if (firstVal !== null && secondVal !== null && segs[0]?.x < 100) {
      openingBalance = firstVal;
      bb.openingBalance = toBBox(segs[0], line);

      closingBalance = secondVal;
      bb.closingBalance = toBBox(segs[1], line);

      // Deposits and withdrawals may be in a combined segment: "+$24,071.00 -$18,923.12"
      for (let s = 2; s < segs.length; s++) {
        const segText = segs[s].text;
        const depMatch = segText.match(/\+\$([\d,.]+)/);
        if (depMatch) {
          deposits = parseCurrency(depMatch[1]) ?? 0;
          bb.deposits = toBBox(segs[s], line);
        }
        const wdMatch = segText.match(/-\$([\d,.]+)/);
        if (wdMatch) {
          withdrawals = parseCurrency(wdMatch[1]) ?? 0;
          bb.withdrawals = toBBox(segs[s], line);
        }
      }
      break;
    }
  }

  return { openingBalance, closingBalance, deposits, withdrawals, boundingBoxes: bb };
}

// ── Transactions ──────────────────────────────────────────────────────────

function parseTransactions(lines: TextLine[]): Transaction[] {
  const transactions: Transaction[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.page > 1) break;

    // Detect data line: has date at x≈290, status at x≈369, amount at x≈417, balance at x≈495
    const dateSeg = line.segments.find((s) => s.x >= 270 && s.x < 360);
    const statusSeg = line.segments.find((s) => s.x >= 360 && s.x < 410);
    const amountSeg = line.segments.find((s) => s.x >= 410 && s.x < 490);
    const balanceSeg = line.segments.find((s) => s.x >= 490);

    if (!dateSeg || !amountSeg || !balanceSeg) continue;

    const date = longDateToISO(dateSeg.text);
    if (!date) continue;

    const bb: Record<string, BoundingBox> = {};
    bb.date = toBBox(dateSeg, line);

    const status = statusSeg?.text.trim() ?? "";
    if (statusSeg) bb.status = toBBox(statusSeg, line);

    // Amount: "+$24,071.00" or "-$4,000.00"
    const amtText = amountSeg.text.trim();
    const isNeg = amtText.startsWith("-");
    const amtClean = amtText.replace(/^[+-]/, "");
    const amtVal = parseCurrency(amtClean) ?? 0;
    const amount = isNeg ? -amtVal : amtVal;
    bb.amount = toBBox(amountSeg, line);

    // Balance
    const balance = parseCurrency(balanceSeg.text) ?? 0;
    bb.balance = toBBox(balanceSeg, line);

    // Description: previous line at x≈78 (name)
    let description = "";
    if (i > 0) {
      const prevLine = lines[i - 1];
      if (prevLine.page === line.page) {
        const descSegs = prevLine.segments.filter((s) => s.x < 270);
        if (descSegs.length > 0) {
          description = descSegs.map((s) => s.text.trim()).join(" ");
          bb.description = toBBox(descSegs[0], prevLine);
        }
      }
    }

    // Type: next line at x≈78 (e.g., "ACH Pull", "Wire", "ACH (TH)")
    let type = "";
    if (i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      if (nextLine.page === line.page) {
        const typeSegs = nextLine.segments.filter((s) => s.x < 270);
        if (typeSegs.length > 0) {
          const typeText = typeSegs.map((s) => s.text.trim()).join(" ");
          // Only treat as type if it's short and doesn't look like a new transaction name
          if (typeText.length < 40) {
            type = typeText;
            bb.type = toBBox(typeSegs[0], nextLine);
          }
        }
      }
    }

    transactions.push({ date, description, type, status, amount, balance, boundingBoxes: bb });
  }

  return transactions;
}
