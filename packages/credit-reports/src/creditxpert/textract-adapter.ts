import type { BoundingBox, TextLine } from "@parseo/shared";
import { extractLines } from "@parseo/shared";
import type { TextractResult } from "../xactus/textract-adapter.js";
import { parseCreditXpertFromLines } from "./parser.js";
import type { CreditXpertReport } from "./types.js";

// ── Public types ─────────────────────────────────────────────────────────────

export interface CreditXpertParseResult {
  results: TextractResult[];
  report: CreditXpertReport;
}

// ── Helper ───────────────────────────────────────────────────────────────────

function result(
  key: string,
  text: string | null,
  boundingBox: BoundingBox | null,
): TextractResult {
  return { key, text, boundingBox };
}

// ── Builders ─────────────────────────────────────────────────────────────────

function buildResults(report: CreditXpertReport): TextractResult[] {
  // 1-2. Applicant name split into first / last
  const nameParts = (report.applicantName || "").split(/\s+/);
  const firstName = nameParts[0] || null;
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;
  const nameBBox = report.boundingBoxes.applicantName ?? null;

  // 3. Co-applicant name
  const coApplicantName = report.coApplicantName || null;
  const coApplicantBBox = report.boundingBoxes.coApplicantName ?? null;

  // 4-6. Bureau scores
  const tu = report.scores.find((s) => s.bureau === "TransUnion");
  const exp = report.scores.find((s) => s.bureau === "Experian");
  const eq = report.scores.find((s) => s.bureau === "Equifax");

  return [
    result("guarantorFirstName", firstName, nameBBox),
    result("guarantorLastName", lastName, nameBBox),
    result("coApplicantName", coApplicantName, coApplicantBBox),
    result(
      "transUnionScore",
      tu?.currentScore != null ? String(tu.currentScore) : null,
      tu?.boundingBoxes.currentScore ?? null,
    ),
    result(
      "experianScore",
      exp?.currentScore != null ? String(exp.currentScore) : null,
      exp?.boundingBoxes.currentScore ?? null,
    ),
    result(
      "equifaxScore",
      eq?.currentScore != null ? String(eq.currentScore) : null,
      eq?.boundingBoxes.currentScore ?? null,
    ),
    // 7-19. Keys not available in CreditXpert reports
    result("sentTo", null, null),
    result("documentDate", null, null),
    result("guarantorAddress", null, null),
    result("ssn", null, null),
    result("openTrade", null, null),
    result("monthlyObligations", null, null),
    result("delinquencies", null, null),
    result("totalDebtHighCredit", null, null),
    result("creditUtilization", null, null),
    result("bankruptcy", null, null),
    result("inquiries", null, null),
    result("inquiriesLast12Months", null, null),
    result("liensJudgments", null, null),
  ];
}

// ── Public API ───────────────────────────────────────────────────────────────

export function parseCreditXpertForTextractFromLines(
  allLines: TextLine[],
): CreditXpertParseResult {
  const report = parseCreditXpertFromLines(allLines);
  const results = buildResults(report);
  return { results, report };
}

export async function parseCreditXpertForTextract(
  buffer: Buffer,
): Promise<CreditXpertParseResult> {
  const allLines = await extractLines(buffer);
  return parseCreditXpertForTextractFromLines(allLines);
}
