import { extractLines } from "@parseo/shared";
import { parseCreditReportFromLines } from "./router.js";
import type { TextLine } from "@parseo/shared";
import type { CreditReportFormat } from "./router.js";
import type { XactusCreditReport } from "./xactus/types.js";
import type { PCBCreditReport } from "./pcb/types.js";
import type { CreditXpertReport } from "./creditxpert/types.js";
import type { TextractResult } from "./xactus/textract-adapter.js";

import { parseXactusForTextractFromLines } from "./xactus/textract-adapter.js";
import { parsePCBForTextractFromLines } from "./pcb/textract-adapter.js";
import { parseCreditXpertForTextractFromLines } from "./creditxpert/textract-adapter.js";

export type { TextractResult };

// ── Types ───────────────────────────────────────────────────────────────────

export interface CreditReportTextractResult {
  format: CreditReportFormat;
  results: TextractResult[];
  report: XactusCreditReport | PCBCreditReport | CreditXpertReport;
  creditXpert?: CreditXpertReport;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function mergeResults(
  primary: TextractResult[],
  secondary: TextractResult[]
): TextractResult[] {
  const merged = [...primary];
  for (const sec of secondary) {
    const existing = merged.find((r) => r.key === sec.key);
    if (!existing) {
      merged.push(sec);
    } else if (existing.text === null && sec.text !== null) {
      existing.text = sec.text;
      existing.boundingBox = sec.boundingBox;
    }
  }
  return merged;
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function parseCreditReportForTextract(
  buffer: Buffer
): Promise<CreditReportTextractResult> {
  const allLines = await extractLines(buffer);
  return parseCreditReportForTextractFromLines(allLines);
}

export function parseCreditReportForTextractFromLines(
  allLines: TextLine[]
): CreditReportTextractResult {
  const routerResult = parseCreditReportFromLines(allLines);

  switch (routerResult.format) {
    case "xactus": {
      const { results } = parseXactusForTextractFromLines(allLines);
      return { format: "xactus", results, report: routerResult.report };
    }

    case "pcb": {
      const { results } = parsePCBForTextractFromLines(allLines);
      return { format: "pcb", results, report: routerResult.report };
    }

    case "creditxpert": {
      const { results } = parseCreditXpertForTextractFromLines(allLines);
      return { format: "creditxpert", results, report: routerResult.report };
    }

    case "pcb+creditxpert": {
      const cxBoundary = findCreditXpertBoundary(allLines);
      const cxLines = allLines.slice(0, cxBoundary);
      const pcbLines = allLines.slice(cxBoundary);

      const { results: pcbResults } = parsePCBForTextractFromLines(pcbLines);
      const { results: cxResults } = parseCreditXpertForTextractFromLines(cxLines);

      const results = mergeResults(pcbResults, cxResults);

      return {
        format: "pcb+creditxpert",
        results,
        report: routerResult.report,
        creditXpert: routerResult.creditXpert,
      };
    }
  }
}

function findCreditXpertBoundary(lines: TextLine[]): number {
  // CreditXpert is always page 1 — use page boundary as primary strategy
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
