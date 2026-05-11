import { extractLines, parseCurrency, toBBox, UnrecognizedFormatError } from "@parseo/shared";
import type { TextLine, DateString, BoundingBox } from "@parseo/shared";
import type {
  PNCStatement,
  AccountHolder,
  BalanceSummary,
  Check,
  Transaction,
} from "./types.js";

export async function parsePNCStatement(buffer: Buffer): Promise<PNCStatement> {
  const lines = await extractLines(buffer);
  return parsePNCFromLines(lines);
}

export function parsePNCFromLines(lines: TextLine[]): PNCStatement {
  const head = lines.slice(0, 30).map((l) => l.fullText).join("\n");
  if (!/PNC Bank/i.test(head) && !/pnc\.com/i.test(head)) {
    throw new UnrecognizedFormatError(
      "PNC",
      "first 30 lines do not contain a PNC Bank signature"
    );
  }

  const bb: Record<string, BoundingBox> = {};
  const accountHolder = parseAccountHolder(lines);
  const { accountNumber, accountType } = parseAccountInfo(lines);
  const statementPeriod = parseStatementPeriod(lines);
  const year = parseInt(statementPeriod.end?.slice(0, 4) ?? "2025", 10);
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
    totalDeposits: summary.depositsAndAdditions,
    totalWithdrawals: summary.checksAndDeductions,
    boundingBoxes: bb,
  };
}

// ── Account holder ────────────────────────────────────────────────────────

function parseAccountHolder(lines: TextLine[]): AccountHolder {
  const bb: Record<string, BoundingBox> = {};
  const page1 = lines.filter((l) => l.page === 1);

  let name = "";
  const addressParts: string[] = [];

  for (const line of page1) {
    if (line.y < 100 || line.y > 145) continue;
    const leftSegs = line.segments.filter((s) => s.x >= 120 && s.x < 300);
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

// ── Account info ──────────────────────────────────────────────────────────

function parseAccountInfo(lines: TextLine[]): { accountNumber: string; accountType: string } {
  let accountNumber = "";
  let accountType = "";

  for (const line of lines) {
    if (!accountNumber) {
      const m = line.fullText.match(/Account Number:\s*([\w-]+)/i);
      if (m) accountNumber = m[1];
    }
    if (!accountType && line.page === 1 && line.y < 50) {
      const m = line.fullText.match(/^(Business Checking|Personal Checking|Business Savings)/i);
      if (m) accountType = m[1];
    }
  }

  return { accountNumber, accountType };
}

// ── Statement period ──────────────────────────────────────────────────────

function parseStatementPeriod(lines: TextLine[]): { start: DateString; end: DateString } {
  for (const line of lines) {
    const m = line.fullText.match(
      /For the Period\s+(\d{2})\/(\d{2})\/(\d{4})\s+to\s+(\d{2})\/(\d{2})\/(\d{4})/i
    );
    if (m) {
      return {
        start: `${m[3]}-${m[1]}-${m[2]}`,
        end: `${m[6]}-${m[4]}-${m[5]}`,
      };
    }
  }
  return { start: null, end: null };
}

// ── Balance summary ───────────────────────────────────────────────────────

function parseBalanceSummary(lines: TextLine[]): BalanceSummary {
  const bb: Record<string, BoundingBox> = {};
  let beginningBalance = 0;
  let depositsAndAdditions = 0;
  let checksAndDeductions = 0;
  let endingBalance = 0;
  let averageLedger = 0;
  let averageCollected = 0;

  // Balance summary is on page 2, around y=133-189
  // Values are on a single line at y≈153: "2,042.92  114,981.67  36,276.22  80,748.37"
  for (const line of lines) {
    if (line.page !== 2) continue;

    // Main balance row (4 values)
    if (line.y >= 148 && line.y <= 158) {
      const numSegs = line.segments.filter((s) => parseCurrency(s.text) !== null);
      if (numSegs.length >= 4) {
        beginningBalance = parseCurrency(numSegs[0].text) ?? 0;
        bb.beginningBalance = toBBox(numSegs[0], line);
        depositsAndAdditions = parseCurrency(numSegs[1].text) ?? 0;
        bb.depositsAndAdditions = toBBox(numSegs[1], line);
        checksAndDeductions = parseCurrency(numSegs[2].text) ?? 0;
        bb.checksAndDeductions = toBBox(numSegs[2], line);
        endingBalance = parseCurrency(numSegs[3].text) ?? 0;
        bb.endingBalance = toBBox(numSegs[3], line);
      }
    }

    // Average balances row (2 values)
    if (line.y >= 184 && line.y <= 194) {
      const numSegs = line.segments.filter((s) => parseCurrency(s.text) !== null);
      if (numSegs.length >= 2) {
        averageLedger = parseCurrency(numSegs[0].text) ?? 0;
        bb.averageLedger = toBBox(numSegs[0], line);
        averageCollected = parseCurrency(numSegs[1].text) ?? 0;
        bb.averageCollected = toBBox(numSegs[1], line);
      }
    }
  }

  return { beginningBalance, depositsAndAdditions, checksAndDeductions, endingBalance, averageLedger, averageCollected, boundingBoxes: bb };
}

// ── Checks ────────────────────────────────────────────────────────────────

function parseChecks(lines: TextLine[], year: number): Check[] {
  const checks: Check[] = [];
  let inChecks = false;

  for (const line of lines) {
    const text = line.fullText.trim();

    if (/^Checks and Substitute Checks/i.test(text)) {
      inChecks = true;
      continue;
    }
    if (inChecks && /^(Debit Card Purchases|ACH Deductions|Service Charges|Other Deductions)/i.test(text)) {
      inChecks = false;
      continue;
    }
    if (!inChecks) continue;

    // Skip headers
    if (/^Date\s+Check/i.test(text)) continue;
    if (/^posted\s+number/i.test(text)) continue;
    if (/Gap in check/i.test(text)) continue;

    // Parse checks from fullText using regex
    const fullText = line.fullText;
    const checkRx = /(\d{2}\/\d{2})\s+(\d+)\s*\*?\s+([\d,.]+)\s+(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = checkRx.exec(fullText)) !== null) {
      const [mm, dd] = m[1].split("/");
      const date: DateString = `${year}-${mm}-${dd}`;
      const checkNumber = m[2];
      const amount = parseCurrency(m[3]) ?? 0;
      const referenceNumber = m[4];

      const txBb: Record<string, BoundingBox> = {};
      txBb.date = toBBox(line.segments[0], line);

      checks.push({ date, checkNumber, amount, referenceNumber, boundingBoxes: txBb });
    }
  }

  return checks;
}

// ── Transactions ──────────────────────────────────────────────────────────

const DEPOSIT_SECTIONS = new Set([
  "Deposits",
  "ATM Deposits and Additions",
  "Other Additions",
]);

const WITHDRAWAL_SECTIONS = new Set([
  "Debit Card Purchases",
  "ACH Deductions",
  "Service Charges and Fees",
  "Other Deductions",
]);

const ALL_SECTIONS = [
  "Deposits",
  "ATM Deposits and Additions",
  "Other Additions",
  "Debit Card Purchases",
  "ACH Deductions",
  "Service Charges and Fees",
  "Other Deductions",
];

function parseTransactions(lines: TextLine[], year: number): Transaction[] {
  const transactions: Transaction[] = [];
  let currentSection: string | null = null;
  let currentTx: Transaction | null = null;

  for (const line of lines) {
    // Skip page headers on continuation pages (y < 110)
    if (line.page > 1 && line.y < 110) continue;

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

    // End of activity detail
    if (/^Daily Balance$/i.test(text) || /^Detail of Services/i.test(text)) {
      if (currentTx) { transactions.push(currentTx); currentTx = null; }
      currentSection = null;
      continue;
    }

    // Skip non-section, headers, checks section
    if (!currentSection) continue;
    if (/^Checks and Substitute Checks/i.test(text)) {
      if (currentTx) { transactions.push(currentTx); currentTx = null; }
      currentSection = null;
      continue;
    }
    if (/^Date\b/i.test(text) && /posted/i.test(line.fullText)) continue;
    if (/^posted\s/i.test(text)) continue;

    // Check for a date segment at x < 50
    const dateSeg = line.segments.find(
      (s) => s.x < 50 && /^\d{2}\/\d{2}$/.test(s.text.trim())
    );

    if (dateSeg) {
      // Save previous transaction
      if (currentTx) transactions.push(currentTx);

      const txBb: Record<string, BoundingBox> = {};
      const [mm, dd] = dateSeg.text.trim().split("/");
      const date: DateString = `${year}-${mm}-${dd}`;
      txBb.date = toBBox(dateSeg, line);

      const type = DEPOSIT_SECTIONS.has(currentSection) ? "deposit" : "withdrawal";

      // Parse amount and description
      // Try to find a standalone amount segment (x 100-200, pure number)
      const amtSeg = line.segments.find(
        (s) => s.x > 100 && s.x < 200 && /^[\d,.]+$/.test(s.text.trim())
      );

      let amount = 0;
      let description = "";
      let referenceNumber = "";

      if (amtSeg) {
        // Standalone amount segment
        amount = parseCurrency(amtSeg.text) ?? 0;
        txBb.amount = toBBox(amtSeg, line);

        // Description: segments at x >= 200 and x < 460
        const descSegs = line.segments.filter((s) => s.x >= 200 && s.x < 450);
        description = descSegs.map((s) => s.text).join(" ").trim();
        if (descSegs.length > 0) txBb.description = toBBox(descSegs[0], line);

        // Reference: segment at x >= 460
        const refSeg = line.segments.find((s) => s.x >= 450);
        referenceNumber = refSeg?.text.trim() ?? "";
      } else {
        // Amount merged with description (e.g., "425.00 0839 Debit Card Purchase ...")
        const mergedSeg = line.segments.find(
          (s) => s.x > 100 && s.x < 200 && /^\d[\d,.]*\s/.test(s.text.trim())
        );
        if (mergedSeg) {
          const mergedMatch = mergedSeg.text.trim().match(/^([\d,.]+)\s+(.*)/);
          if (mergedMatch) {
            amount = parseCurrency(mergedMatch[1]) ?? 0;
            txBb.amount = toBBox(mergedSeg, line);
            description = mergedMatch[2].trim();
            txBb.description = toBBox(mergedSeg, line);
          }

          // Additional description segments
          const extraDescSegs = line.segments.filter(
            (s) => s.x > mergedSeg.x + mergedSeg.width && s.x < 460
          );
          if (extraDescSegs.length > 0) {
            description += " " + extraDescSegs.map((s) => s.text).join(" ").trim();
          }

          // Reference
          const refSeg = line.segments.find((s) => s.x >= 450);
          referenceNumber = refSeg?.text.trim() ?? "";
        }
      }

      if (type === "withdrawal") amount = -amount;

      currentTx = {
        date,
        description,
        amount,
        type,
        category: currentSection,
        referenceNumber,
        boundingBoxes: txBb,
      };
    } else if (currentTx) {
      // Continuation line — append to description
      const descSegs = line.segments.filter((s) => s.x >= 100 && s.x < 450);
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
