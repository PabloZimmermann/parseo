import { extractLines } from "@parseo/shared";
import { parseXactusFromLines } from "./xactus/parser.js";
import { parsePCBFromLines } from "./pcb/parser.js";
import { parseCreditXpertFromLines } from "./creditxpert/parser.js";
import type { TextLine } from "@parseo/shared";
import type { XactusCreditReport } from "./xactus/types.js";
import type { PCBCreditReport } from "./pcb/types.js";
import type { CreditXpertReport } from "./creditxpert/types.js";

// ── Types ───────────────────────────────────────────────────────────────────

export type CreditReportFormat = "xactus" | "pcb" | "creditxpert" | "pcb+creditxpert";

export interface CreditReportResult {
  format: CreditReportFormat;
  report: XactusCreditReport | PCBCreditReport | CreditXpertReport;
  /** Present when a CreditXpert page preceded the main report */
  creditXpert?: CreditXpertReport;
}

// ── Format detection helpers ────────────────────────────────────────────────

function isCreditXpert(lines: TextLine[]): boolean {
  const head = lines.slice(0, 20).map((l) => l.fullText).join("\n");
  return /creditxpert/i.test(head);
}

function isPCB(lines: TextLine[]): boolean {
  const head = lines.slice(0, 30).map((l) => l.fullText).join("\n");
  return /Premium Credit Bureau|MERGED INFILE CREDIT REPORT/i.test(head);
}

function isXactus(lines: TextLine[]): boolean {
  const head = lines.slice(0, 40).map((l) => l.fullText).join("\n").toLowerCase();
  return (
    head.includes("xactus") ||
    head.includes("credit report x") ||
    head.includes("broomall, pa") ||
    (head.includes("fico") && head.includes("repositories")) ||
    head.includes("credit score information") ||
    head.includes("credit history")
  );
}

/**
 * Find the boundary where CreditXpert content ends.
 * Returns the index (in the lines array) of the first line AFTER CreditXpert content.
 *
 * CreditXpert is always page 1 (including disclaimers).
 * The parser itself handles internal truncation at "Settings Used:".
 * We use the page boundary as primary strategy so the parser gets
 * enough context (including the "CreditXpert" mention in disclaimers)
 * for format validation.
 */
function findCreditXpertBoundary(lines: TextLine[]): number {
  const firstPage = lines[0]?.page ?? 1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].page > firstPage) return i;
  }
  // Single-page PDF — look for content markers
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].fullText.trim();
    if (/^Settings\s+Used:/i.test(t)) return i + 1;
    if (/^Copyright/i.test(t)) return i;
  }
  return lines.length;
}

// ── Router ──────────────────────────────────────────────────────────────────

export async function parseCreditReport(
  buffer: Buffer
): Promise<CreditReportResult> {
  const allLines = await extractLines(buffer);
  return parseCreditReportFromLines(allLines);
}

export function parseCreditReportFromLines(
  allLines: TextLine[]
): CreditReportResult {
  // Check if PDF starts with CreditXpert
  if (isCreditXpert(allLines)) {
    const boundary = findCreditXpertBoundary(allLines);
    const cxLines = allLines.slice(0, boundary);
    const remainingLines = allLines.slice(boundary);

    let creditXpert: CreditXpertReport;
    try {
      creditXpert = parseCreditXpertFromLines(cxLines);
    } catch {
      // CreditXpert parsing failed — try the whole thing as another format
      return parseNonCreditXpert(allLines);
    }

    // If there are remaining lines, try to parse them as PCB or Xactus
    if (remainingLines.length > 10) {
      if (isPCB(remainingLines)) {
        const report = parsePCBFromLines(remainingLines);
        return { format: "pcb+creditxpert", report, creditXpert };
      }
      if (isXactus(remainingLines)) {
        const report = parseXactusFromLines(remainingLines);
        return { format: "pcb+creditxpert", report, creditXpert };
      }
    }

    // Standalone CreditXpert
    return { format: "creditxpert", report: creditXpert };
  }

  return parseNonCreditXpert(allLines);
}

function parseNonCreditXpert(lines: TextLine[]): CreditReportResult {
  if (isPCB(lines)) {
    return { format: "pcb", report: parsePCBFromLines(lines) };
  }
  if (isXactus(lines)) {
    return { format: "xactus", report: parseXactusFromLines(lines) };
  }

  // Last resort: try each parser and see which doesn't throw
  // (handles edge cases where signature detection is too strict)
  const errors: string[] = [];

  try { return { format: "pcb", report: parsePCBFromLines(lines) }; }
  catch (e: any) { errors.push(`PCB: ${e.message}`); }

  try { return { format: "xactus", report: parseXactusFromLines(lines) }; }
  catch (e: any) { errors.push(`Xactus: ${e.message}`); }

  try { return { format: "creditxpert", report: parseCreditXpertFromLines(lines) }; }
  catch (e: any) { errors.push(`CreditXpert: ${e.message}`); }

  throw new Error(
    `Unrecognized credit report format. Tried all parsers:\n${errors.join("\n")}`
  );
}
