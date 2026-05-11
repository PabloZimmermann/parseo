import { extractLines, parseCurrency, toBBox, UnrecognizedFormatError } from "@parseo/shared";
import type { TextLine, DateString, BoundingBox } from "@parseo/shared";
import type {
  SynovusStatement,
  AccountHolder,
  AccountSummary,
  Check,
  Transaction,
} from "./types.js";

const MONTH_NAMES: Record<string, string> = {
  January: "01", February: "02", March: "03", April: "04",
  May: "05", June: "06", July: "07", August: "08",
  September: "09", October: "10", November: "11", December: "12",
};

export async function parseSynovusStatement(buffer: Buffer): Promise<SynovusStatement> {
  const lines = await extractLines(buffer);
  return parseSynovusFromLines(lines);
}

export function parseSynovusFromLines(lines: TextLine[]): SynovusStatement {
  const head = lines.slice(0, 30).map((l) => l.fullText).join("\n");
  if (!/P\.O\.\s*Box\s*2646/i.test(head) && !/888-796-6887/.test(head)) {
    throw new UnrecognizedFormatError(
      "Synovus",
      "first 30 lines do not contain a Synovus signature"
    );
  }

  const bb: Record<string, BoundingBox> = {};
  const accountHolder = parseAccountHolder(lines);
  const { accountNumber, accountType } = parseAccountInfo(lines);
  const statementPeriod = parseStatementPeriod(lines);
  const year = parseInt(statementPeriod.end?.slice(0, 4) ?? "2024", 10);
  const summary = parseBalanceSummary(lines);
  const checks = parseChecks(lines, year);
  const transactions = parseTransactions(lines, year);

  return {
    accountHolder,
    accountNumber,
    accountType,
    statementPeriod,
    summary,
    checks,
    transactions,
    totalDeposits: summary.depositsCredits,
    totalWithdrawals: summary.withdrawalsDebits,
    boundingBoxes: bb,
  };
}

// ── Account holder ────────────────────────────────────────────────────────

function parseAccountHolder(lines: TextLine[]): AccountHolder {
  const bb: Record<string, BoundingBox> = {};
  const page1 = lines.filter((l) => l.page === 1);

  let name = "";
  const addressParts: string[] = [];

  // Account holder at x≈108, y 190-230
  for (const line of page1) {
    if (line.y < 180 || line.y > 240) continue;
    const segs = line.segments.filter((s) => s.x >= 90 && s.x < 300);
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
    // "Pro Business Checking  Account Number 101-888-513-5"
    const m = line.fullText.match(/^(.+?)\s+Account Number\s+([\d-]+)/i);
    if (m) {
      accountType = m[1].trim();
      accountNumber = m[2];
      break;
    }
  }

  return { accountNumber, accountType };
}

// ── Statement period ──────────────────────────────────────────────────────

function parseStatementPeriod(lines: TextLine[]): { start: DateString; end: DateString } {
  let lastDate: DateString = null;
  let thisDate: DateString = null;

  for (const line of lines) {
    if (line.page !== 1) continue;

    const lastM = line.fullText.match(
      /Last statement:\s*(\w+)\s+(\d{1,2}),?\s+(\d{4})/i
    );
    if (lastM) {
      const month = MONTH_NAMES[lastM[1]];
      if (month) {
        const day = lastM[2].padStart(2, "0");
        // Start = day after last statement
        const d = new Date(parseInt(lastM[3], 10), parseInt(month, 10) - 1, parseInt(day, 10) + 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        lastDate = `${y}-${m}-${dd}`;
      }
    }

    const thisM = line.fullText.match(
      /This statement:\s*(\w+)\s+(\d{1,2}),?\s+(\d{4})/i
    );
    if (thisM) {
      const month = MONTH_NAMES[thisM[1]];
      if (month) {
        const day = thisM[2].padStart(2, "0");
        thisDate = `${thisM[3]}-${month}-${day}`;
      }
    }
  }

  return { start: lastDate, end: thisDate };
}

// ── Balance summary ───────────────────────────────────────────────────────

function parseBalanceSummary(lines: TextLine[]): AccountSummary {
  const bb: Record<string, BoundingBox> = {};
  const summary: AccountSummary = {
    beginningBalance: 0,
    depositsCredits: 0,
    withdrawalsDebits: 0,
    endingBalance: 0,
    lowBalance: 0,
    averageBalance: 0,
    averageCollectedBalance: 0,
    boundingBoxes: bb,
  };

  // Summary is on page 1, y ≈ 400-445
  for (const line of lines) {
    if (line.page !== 1) continue;
    if (line.y < 395 || line.y > 450) continue;

    // Left-side: label at x < 200, value at x 220-300
    const leftLabel = line.segments.find((s) => s.x < 200);
    const leftValue = line.segments.find((s) => s.x >= 220 && s.x < 300);
    // Right-side: label at x 300-480, value at x > 480
    const rightLabel = line.segments.find((s) => s.x >= 300 && s.x < 480);
    const rightValue = line.segments.find((s) => s.x >= 480);

    if (leftLabel && leftValue) {
      const label = leftLabel.text.trim().toLowerCase();
      const val = parseCurrency(leftValue.text) ?? 0;

      if (label.includes("beginning")) {
        summary.beginningBalance = val;
        bb.beginningBalance = toBBox(leftValue, line);
      } else if (label.includes("deposits")) {
        summary.depositsCredits = val;
        bb.depositsCredits = toBBox(leftValue, line);
      } else if (label.includes("withdrawals")) {
        summary.withdrawalsDebits = val;
        bb.withdrawalsDebits = toBBox(leftValue, line);
      } else if (label.includes("ending")) {
        summary.endingBalance = val;
        bb.endingBalance = toBBox(leftValue, line);
      }
    }

    if (rightLabel && rightValue) {
      const label = rightLabel.text.trim().toLowerCase();
      const val = parseCurrency(rightValue.text) ?? 0;

      if (label.includes("low")) {
        summary.lowBalance = val;
        bb.lowBalance = toBBox(rightValue, line);
      } else if (label.includes("average collected")) {
        summary.averageCollectedBalance = val;
        bb.averageCollectedBalance = toBBox(rightValue, line);
      } else if (label.includes("average")) {
        summary.averageBalance = val;
        bb.averageBalance = toBBox(rightValue, line);
      }
    }
  }

  return summary;
}

// ── Checks ────────────────────────────────────────────────────────────────

function parseChecks(lines: TextLine[], year: number): Check[] {
  const checks: Check[] = [];
  let inChecks = false;

  for (const line of lines) {
    const text = line.fullText.trim();

    if (/^Checks$/i.test(text)) {
      inChecks = true;
      continue;
    }
    if (inChecks && /^(Other Debits|Deposits|Balance Summary)/i.test(text)) {
      inChecks = false;
      continue;
    }
    if (!inChecks) continue;

    // Skip headers
    if (/^Number\s+Date/i.test(text)) continue;

    // Parse checks via regex: number, date (MM/DD), amount
    const checkRx = /(\d+)\s*\*?\s+(\d{2}\/\d{2})\s+([\d,.]+)/g;
    let m: RegExpExecArray | null;
    while ((m = checkRx.exec(line.fullText)) !== null) {
      const [mm, dd] = m[2].split("/");
      const date: DateString = `${year}-${mm}-${dd}`;
      const checkNumber = m[1];
      const amount = parseCurrency(m[3]) ?? 0;

      const txBb: Record<string, BoundingBox> = {};
      txBb.date = toBBox(line.segments[0], line);

      checks.push({ date, checkNumber, amount, boundingBoxes: txBb });
    }
  }

  return checks;
}

// ── Transactions ──────────────────────────────────────────────────────────

function parseTransactions(lines: TextLine[], year: number): Transaction[] {
  const transactions: Transaction[] = [];
  let currentSection: "deposit" | "withdrawal" | null = null;
  let currentTx: Transaction | null = null;

  for (const line of lines) {
    // Skip page headers on continuation pages
    if (line.page > 1 && line.y < 100) continue;

    const text = line.fullText.trim();

    // Detect section headers
    if (/^Other Debits$/i.test(text)) {
      if (currentTx) { transactions.push(currentTx); currentTx = null; }
      currentSection = "withdrawal";
      continue;
    }
    if (/^Deposits\/Other Credits$/i.test(text)) {
      if (currentTx) { transactions.push(currentTx); currentTx = null; }
      currentSection = "deposit";
      continue;
    }

    // End of transaction sections
    if (/^Balance Summary$/i.test(text) || /^Checks$/i.test(text)) {
      if (currentTx) { transactions.push(currentTx); currentTx = null; }
      currentSection = null;
      continue;
    }

    if (!currentSection) continue;

    // Skip column headers
    if (/^Date\s+Transaction Type/i.test(text)) continue;

    // Check for date segment at x < 55 with MM-DD pattern
    const dateSeg = line.segments.find(
      (s) => s.x < 55 && /^\d{2}-\d{2}$/.test(s.text.trim())
    );

    if (dateSeg) {
      // Save previous transaction
      if (currentTx) transactions.push(currentTx);

      const txBb: Record<string, BoundingBox> = {};
      const [mm, dd] = dateSeg.text.trim().split("-");
      const date: DateString = `${year}-${mm}-${dd}`;
      txBb.date = toBBox(dateSeg, line);

      // Transaction type at x ≈ 87
      const typeSeg = line.segments.find((s) => s.x >= 70 && s.x < 195);
      const transactionType = typeSeg?.text.trim() ?? "";

      // Description at x ≈ 198
      const descSegs = line.segments.filter((s) => s.x >= 195 && s.x < 520);
      const description = descSegs.map((s) => s.text).join(" ").trim();
      if (descSegs.length > 0) txBb.description = toBBox(descSegs[0], line);

      // Amount at x > 520
      const amtSeg = line.segments.find((s) => s.x >= 520);
      let amount = 0;
      if (amtSeg) {
        amount = parseCurrency(amtSeg.text) ?? 0;
        txBb.amount = toBBox(amtSeg, line);
      }

      if (currentSection === "withdrawal") amount = -amount;

      currentTx = {
        date,
        transactionType,
        description,
        amount,
        type: currentSection,
        boundingBoxes: txBb,
      };
    } else if (currentTx) {
      // Continuation line — append description from segments at x ≈ 198
      const descSegs = line.segments.filter((s) => s.x >= 195 && s.x < 520);
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
