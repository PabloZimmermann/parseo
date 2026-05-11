import { extractLines, classifyDocument } from "@parseo/shared";
import type { TextLine, FormatName, ClassifyResult } from "@parseo/shared";

import { parseSmartLinxReportFromLines } from "@parseo/background-checks";
import { parseCreditReportFromLines } from "@parseo/credit-reports";
import {
  parseRicherValuesReportFromLines,
  parseForm1004MCFromLines,
  parseForm1073FromLines,
} from "@parseo/appraisals";
import {
  parseWellsFargoFromLines,
  parseTDBankFromLines,
  parseChaseFromLines,
  parseBankOfAmericaFromLines,
  parseNavyFederalFromLines,
  parseThirdFederalFromLines,
  parseCitibankFromLines,
  parseRelayFromLines,
  parseGroveBankFromLines,
  parseCapitalOneFromLines,
  parseTruistFromLines,
  parsePNCFromLines,
  parseDiscoverFromLines,
  parseSynovusFromLines,
} from "@parseo/bank-statements";

// ── Result type ──────────────────────────────────────────────

export interface ParseResult {
  /** Which format was detected */
  format: FormatName;
  /** Parsed data (type depends on format) */
  data: unknown;
  /** Number of intro pages that were skipped */
  skippedPages: number;
  /** Classifier confidence score */
  confidence: number;
}

// ── Page helpers ─────────────────────────────────────────────

function skipPages(lines: TextLine[], pagesToSkip: number): TextLine[] {
  const minPage = lines.length > 0 ? lines[0].page : 1;
  const firstKeptPage = minPage + pagesToSkip;
  return lines
    .filter((l) => l.page >= firstKeptPage)
    .map((l) => ({ ...l, page: l.page - pagesToSkip }));
}

function offsetBoundingBoxPages(obj: unknown, offset: number): void {
  if (offset === 0 || obj == null || typeof obj !== "object") return;
  const record = obj as Record<string, unknown>;
  if (typeof record.pageNumber === "number" && "x" in record && "y" in record) {
    record.pageNumber = (record.pageNumber as number) + offset;
    return;
  }
  for (const value of Object.values(record)) {
    if (value != null && typeof value === "object") {
      offsetBoundingBoxPages(value, offset);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────

/**
 * Universal parser. Extracts text from the PDF, classifies the document,
 * and routes to the correct parser.
 *
 * Returns `null` if no known format is detected.
 */
export async function parse(buffer: Buffer): Promise<ParseResult | null> {
  const allLines = await extractLines(buffer);
  const classification = classifyDocument(allLines);

  if (!classification) return null;

  const { format, skip, confidence } = classification;
  const lines = skip > 0 ? skipPages(allLines, skip) : allLines;

  let data: unknown;

  switch (format) {
    case "smartlinx":
      data = parseSmartLinxReportFromLines(lines);
      break;
    case "credit-report": {
      const cr = parseCreditReportFromLines(lines);
      data = {
        format: cr.format,
        report: cr.report,
        ...(cr.creditXpert ? { creditXpert: cr.creditXpert } : {}),
      };
      break;
    }
    case "richer-values":
      data = parseRicherValuesReportFromLines(lines);
      break;
    case "form-1004mc":
      data = await parseForm1004MCFromLines(lines, buffer, skip);
      break;
    case "form-1073":
      data = await parseForm1073FromLines(lines, buffer, skip);
      break;
    case "wells-fargo":
      data = parseWellsFargoFromLines(lines);
      break;
    case "td-bank":
      data = parseTDBankFromLines(lines);
      break;
    case "chase":
      data = parseChaseFromLines(lines);
      break;
    case "bank-of-america":
      data = parseBankOfAmericaFromLines(lines);
      break;
    case "navy-federal":
      data = parseNavyFederalFromLines(lines);
      break;
    case "third-federal":
      data = parseThirdFederalFromLines(lines);
      break;
    case "citibank":
      data = parseCitibankFromLines(lines);
      break;
    case "relay":
      data = parseRelayFromLines(lines);
      break;
    case "grove-bank":
      data = parseGroveBankFromLines(lines);
      break;
    case "capital-one":
      data = parseCapitalOneFromLines(lines);
      break;
    case "truist":
      data = parseTruistFromLines(lines);
      break;
    case "pnc":
      data = parsePNCFromLines(lines);
      break;
    case "discover":
      data = parseDiscoverFromLines(lines);
      break;
    case "synovus":
      data = parseSynovusFromLines(lines);
      break;
  }

  if (skip > 0) offsetBoundingBoxPages(data, skip);

  return { format, data, skippedPages: skip, confidence };
}
