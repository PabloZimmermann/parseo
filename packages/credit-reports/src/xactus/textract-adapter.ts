import type { BoundingBox, TextLine } from "@parseo/shared";
import { extractLines } from "@parseo/shared";
import type { XactusCreditReport } from "./types.js";
import { parseXactusFromLines } from "./parser.js";

// ── Public types ────────────────────────────────────────────────────────────

export interface TextractResult {
  key: string;
  text: string | null;
  boundingBox: BoundingBox | null;
}

export interface XactusParseResult {
  results: TextractResult[];
  report: XactusCreditReport;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function result(
  key: string,
  text: string | null | undefined,
  boundingBox: BoundingBox | null | undefined,
): TextractResult {
  const hasValue = text !== null && text !== undefined && text !== "";
  return {
    key,
    text: hasValue ? text : null,
    boundingBox: hasValue ? (boundingBox ?? null) : null,
  };
}

function findScoreByRepo(
  scores: XactusCreditReport["creditScores"],
  ...patterns: string[]
): { score: number | null; boundingBoxes: Record<string, BoundingBox> } | undefined {
  return scores.find((s) =>
    patterns.some((p) => s.repository.includes(p)),
  );
}

function findTotalsRow(
  rows: XactusCreditReport["creditSummary"],
): XactusCreditReport["creditSummary"][number] | undefined {
  return rows.find((r) => r.accountType.includes("Total"));
}

// ── Builder ─────────────────────────────────────────────────────────────────

function buildResults(report: XactusCreditReport): TextractResult[] {
  const results: TextractResult[] = [];

  // 1. sentTo
  results.push(
    result("sentTo", report.header.clientName, report.header.boundingBoxes.clientName),
  );

  // 2. documentDate
  results.push(
    result("documentDate", report.header.released, report.header.boundingBoxes.released),
  );

  // 3. guarantorFirstName – first word of borrower name
  const nameParts = report.borrower.name.split(/\s+/);
  const firstName = nameParts[0] ?? null;
  results.push(
    result("guarantorFirstName", firstName, report.borrower.boundingBoxes.name),
  );

  // 4. guarantorLastName – remaining words of borrower name
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;
  results.push(
    result("guarantorLastName", lastName, report.borrower.boundingBoxes.name),
  );

  // 5. guarantorAddress
  results.push(
    result(
      "guarantorAddress",
      report.borrower.currentAddress,
      report.borrower.boundingBoxes.currentAddress,
    ),
  );

  // 6. ssn
  results.push(
    result("ssn", report.borrower.ssn, report.borrower.boundingBoxes.ssn),
  );

  // 7. coApplicantName
  results.push(
    result(
      "coApplicantName",
      report.coBorrower?.name ?? null,
      report.coBorrower?.boundingBoxes?.name,
    ),
  );

  // 8. transUnionScore
  const tu = findScoreByRepo(report.creditScores, "TransUnion", "TU");
  results.push(
    result(
      "transUnionScore",
      tu?.score != null ? String(tu.score) : null,
      tu?.boundingBoxes?.score,
    ),
  );

  // 9. experianScore
  const xpn = findScoreByRepo(report.creditScores, "Experian", "XPN");
  results.push(
    result(
      "experianScore",
      xpn?.score != null ? String(xpn.score) : null,
      xpn?.boundingBoxes?.score,
    ),
  );

  // 10. equifaxScore
  const efx = findScoreByRepo(report.creditScores, "Equifax", "EFX");
  results.push(
    result(
      "equifaxScore",
      efx?.score != null ? String(efx.score) : null,
      efx?.boundingBoxes?.score,
    ),
  );

  // 11-13 come from the "Totals" row in creditSummary
  const totals = findTotalsRow(report.creditSummary);

  // 11. openTrade
  results.push(
    result(
      "openTrade",
      totals?.openAccounts != null ? String(totals.openAccounts) : null,
      totals?.boundingBoxes?.openAccounts,
    ),
  );

  // 12. monthlyObligations – formatted as $${value}
  results.push(
    result(
      "monthlyObligations",
      totals?.payment != null ? `$${totals.payment}` : null,
      totals?.boundingBoxes?.payment,
    ),
  );

  // 13. delinquencies – "late30 late60 late90+" space-separated
  const delinqParts = [totals?.late30Days, totals?.late60Days, totals?.late90PlusDays];
  const hasDelinq = delinqParts.some((v) => v != null);
  results.push(
    result(
      "delinquencies",
      hasDelinq
        ? delinqParts.map((v) => (v != null ? String(v) : "0")).join(" ")
        : null,
      totals?.boundingBoxes?.late30Days,
    ),
  );

  // 14. totalDebtHighCredit
  results.push(
    result(
      "totalDebtHighCredit",
      report.creditSummaryStats.utilizationPercent,
      report.creditSummaryStats.boundingBoxes.utilizationPercent,
    ),
  );

  // 15. creditUtilization – same value and bbox as totalDebtHighCredit
  results.push(
    result(
      "creditUtilization",
      report.creditSummaryStats.utilizationPercent,
      report.creditSummaryStats.boundingBoxes.utilizationPercent,
    ),
  );

  // 16. bankruptcy
  results.push(
    result(
      "bankruptcy",
      report.creditSummaryStats.bankruptcy,
      report.creditSummaryStats.boundingBoxes.bankruptcy,
    ),
  );

  // 17. inquiries
  results.push(
    result(
      "inquiries",
      report.creditSummaryStats.inquiries != null
        ? String(report.creditSummaryStats.inquiries)
        : null,
      report.creditSummaryStats.boundingBoxes.inquiries,
    ),
  );

  // 18. inquiriesLast12Months
  results.push(
    result(
      "inquiriesLast12Months",
      report.inquiries.length === 0
        ? "No inquiries in the last 120 days."
        : String(report.inquiries.length),
      null,
    ),
  );

  // 19. liensJudgments
  results.push(
    result(
      "liensJudgments",
      report.publicRecords.length > 0
        ? report.publicRecords.map((r) => r.text).join(" ")
        : null,
      null,
    ),
  );

  return results;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function parseXactusForTextractFromLines(rawLines: TextLine[]): XactusParseResult {
  const report = parseXactusFromLines(rawLines);
  return { results: buildResults(report), report };
}

export async function parseXactusForTextract(buffer: Buffer): Promise<XactusParseResult> {
  const rawLines = await extractLines(buffer);
  return parseXactusForTextractFromLines(rawLines);
}
