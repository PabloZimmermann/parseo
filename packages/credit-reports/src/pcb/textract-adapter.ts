import type { BoundingBox, TextLine, TextSegment } from "@parseo/shared";
import { extractLines, toBBox } from "@parseo/shared";
import { parsePCBFromLines } from "./parser.js";
import type { PCBCreditReport } from "./types.js";
import type { TextractResult } from "../xactus/textract-adapter.js";

// ── Public types ────────────────────────────────────────────────────────────

export interface PCBParseResult {
  results: TextractResult[];
  report: PCBCreditReport;
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

function findScoreByBureau(
  scores: PCBCreditReport["scoreModels"],
  ...patterns: string[]
): PCBCreditReport["scoreModels"][number] | undefined {
  return scores.find((s) =>
    patterns.some((p) => s.bureau.toUpperCase().includes(p)),
  );
}

function findSegmentAfterLabel(line: TextLine, label: string): TextSegment | null {
  for (let i = 0; i < line.segments.length; i++) {
    const seg = line.segments[i];
    if (seg.text.includes(label)) {
      // Value might be in remaining text of same segment
      const after = seg.text.substring(seg.text.indexOf(label) + label.length).trim();
      if (after && /\d/.test(after)) {
        return line.segments[i + 1] ?? seg;
      }
      // Or in next segment
      if (i + 1 < line.segments.length) return line.segments[i + 1];
    }
  }
  return null;
}

// ── Summary extraction from raw lines ───────────────────────────────────────

interface SummaryFields {
  openTrade: TextractResult;
  monthlyObligations: TextractResult;
  creditUtilization: TextractResult;
  totalDebtHighCredit: TextractResult;
  delinquencies: TextractResult;
  bankruptcy: TextractResult;
  inquiries: TextractResult;
  liensJudgments: TextractResult;
  inquiriesLast12Months: TextractResult;
}

function extractSummaryFields(allLines: TextLine[]): SummaryFields {
  // ── TRADE SUMMARY: find TOTAL row scanning backwards ──

  let totalLine: TextLine | null = null;
  for (let i = allLines.length - 1; i >= 0; i--) {
    if (/^\s*TOTAL\s+\d/.test(allLines[i].fullText)) {
      totalLine = allLines[i];
      break;
    }
  }

  let openTrade = result("openTrade", null, null);
  let monthlyObligations = result("monthlyObligations", null, null);

  if (totalLine) {
    // segments[1] is the first numeric segment after "TOTAL" (the # count)
    if (totalLine.segments.length > 1) {
      const countSeg = totalLine.segments[1];
      openTrade = result("openTrade", countSeg.text.trim(), toBBox(countSeg, totalLine));
    }
    // segments[4] is the PAYMENTS column
    if (totalLine.segments.length > 4) {
      const paymentSeg = totalLine.segments[4];
      monthlyObligations = result("monthlyObligations", paymentSeg.text.trim(), toBBox(paymentSeg, totalLine));
    }
  }

  // ── REVOLVING CREDIT utilization ──

  let creditUtilization = result("creditUtilization", null, null);
  for (let i = allLines.length - 1; i >= 0; i--) {
    const line = allLines[i];
    if (/REVOLVING CREDIT/i.test(line.fullText) && line.fullText.includes("%")) {
      const lastSeg = line.segments[line.segments.length - 1];
      if (lastSeg) {
        creditUtilization = result("creditUtilization", lastSeg.text.trim(), toBBox(lastSeg, line));
      }
      break;
    }
  }

  // ── TOTAL DEBT/HIGH CREDIT ──

  let totalDebtHighCredit = result("totalDebtHighCredit", null, null);
  for (let i = allLines.length - 1; i >= 0; i--) {
    const line = allLines[i];
    if (/TOTAL DEBT\/HIGH CREDIT/i.test(line.fullText)) {
      const lastSeg = line.segments[line.segments.length - 1];
      if (lastSeg) {
        totalDebtHighCredit = result("totalDebtHighCredit", lastSeg.text.trim(), toBBox(lastSeg, line));
      }
      break;
    }
  }

  // ── DEROGATORY SUMMARY ──

  // Find the relevant lines: CHARGE OFFS (has "30 DAYS:"), COLLECTIONS (has "60 DAYS:"), BANKRUPTCY (has "90 DAYS:")
  let chargeOffsLine: TextLine | null = null;
  let collectionsLine: TextLine | null = null;
  let bankruptcyLine: TextLine | null = null;
  let publicRecordsLine: TextLine | null = null;

  for (let i = allLines.length - 1; i >= 0; i--) {
    const ft = allLines[i].fullText;
    if (!chargeOffsLine && ft.includes("CHARGE OFFS") && ft.includes("30 DAYS:")) {
      chargeOffsLine = allLines[i];
    }
    if (!collectionsLine && ft.includes("COLLECTIONS") && ft.includes("60 DAYS:")) {
      collectionsLine = allLines[i];
    }
    if (!bankruptcyLine && ft.includes("BANKRUPTCY") && ft.includes("90 DAYS:")) {
      bankruptcyLine = allLines[i];
    }
    if (!publicRecordsLine && ft.includes("PUBLIC RECORDS:")) {
      publicRecordsLine = allLines[i];
    }
  }

  // Delinquencies: combine 30/60/90 day values
  let delinquencies = result("delinquencies", null, null);
  const day30Seg = chargeOffsLine ? findSegmentAfterLabel(chargeOffsLine, "30 DAYS:") : null;
  const day60Seg = collectionsLine ? findSegmentAfterLabel(collectionsLine, "60 DAYS:") : null;
  const day90Seg = bankruptcyLine ? findSegmentAfterLabel(bankruptcyLine, "90 DAYS:") : null;

  const day30Val = day30Seg?.text.trim().split(/\s/)[0] ?? null;
  const day60Val = day60Seg?.text.trim().split(/\s/)[0] ?? null;
  const day90Val = day90Seg?.text.trim().split(/\s/)[0] ?? null;

  if (day30Val || day60Val || day90Val) {
    const combined = `${day30Val ?? "0"}/${day60Val ?? "0"}/${day90Val ?? "0"}`;
    delinquencies = result(
      "delinquencies",
      combined,
      day30Seg && chargeOffsLine ? toBBox(day30Seg, chargeOffsLine) : null,
    );
  }

  // Bankruptcy: segment after "BANKRUPTCY:" label
  let bankruptcy = result("bankruptcy", null, null);
  if (bankruptcyLine) {
    const bkSeg = findSegmentAfterLabel(bankruptcyLine, "BANKRUPTCY:");
    if (bkSeg) {
      bankruptcy = result("bankruptcy", bkSeg.text.trim().split(/\s/)[0], toBBox(bkSeg, bankruptcyLine));
    }
  }

  // Inquiries: segment after "INQUIRIES:" on the CHARGE OFFS line
  let inquiries = result("inquiries", null, null);
  if (chargeOffsLine) {
    const inqSeg = findSegmentAfterLabel(chargeOffsLine, "INQUIRIES:");
    if (inqSeg) {
      inquiries = result("inquiries", inqSeg.text.trim().split(/\s/)[0], toBBox(inqSeg, chargeOffsLine));
    }
  }

  // Liens/Judgments: segment after "PUBLIC RECORDS:" label
  let liensJudgments = result("liensJudgments", null, null);
  if (publicRecordsLine) {
    const prSeg = findSegmentAfterLabel(publicRecordsLine, "PUBLIC RECORDS:");
    if (prSeg) {
      liensJudgments = result("liensJudgments", prSeg.text.trim().split(/\s/)[0], toBBox(prSeg, publicRecordsLine));
    }
  }

  // ── INQUIRIES (LAST 120 DAYS) ──

  let inquiriesLast12Months = result("inquiriesLast12Months", null, null);

  // Find the "INQUIRIES (LAST 120 DAYS)" section header
  let sectionHeaderIdx = -1;
  let sectionHeaderLine: TextLine | null = null;
  for (let i = 0; i < allLines.length; i++) {
    if (allLines[i].fullText.includes("INQUIRIES (LAST 120 DAYS)")) {
      sectionHeaderIdx = i;
      sectionHeaderLine = allLines[i];
      break;
    }
  }

  if (sectionHeaderIdx >= 0 && sectionHeaderLine) {
    // Count lines starting with bureau codes until hitting a stop marker
    const bureauPattern = /^(XP|TU|EF)(\/(?:XP|TU|EF))*/;
    let count = 0;
    for (let i = sectionHeaderIdx + 1; i < allLines.length; i++) {
      const ft = allLines[i].fullText.trim();
      if (
        ft.startsWith("SOURCE OF INFORMATION") ||
        ft.startsWith("ECOA KEY") ||
        /^Page\s+\d/.test(ft)
      ) {
        break;
      }
      if (bureauPattern.test(ft)) {
        count++;
      }
    }

    const headerSeg = sectionHeaderLine.segments[0];
    inquiriesLast12Months = result(
      "inquiriesLast12Months",
      String(count),
      headerSeg ? toBBox(headerSeg, sectionHeaderLine) : null,
    );
  }

  return {
    openTrade,
    monthlyObligations,
    creditUtilization,
    totalDebtHighCredit,
    delinquencies,
    bankruptcy,
    inquiries,
    liensJudgments,
    inquiriesLast12Months,
  };
}

// ── Builder ─────────────────────────────────────────────────────────────────

function buildResults(report: PCBCreditReport, allLines: TextLine[]): TextractResult[] {
  const results: TextractResult[] = [];

  // 1. sentTo
  results.push(
    result("sentTo", report.header.sendTo, report.header.boundingBoxes.sendTo),
  );

  // 2. documentDate
  results.push(
    result("documentDate", report.header.dateCompleted, report.header.boundingBoxes.dateCompleted),
  );

  // 3. guarantorFirstName – PCB names are "LAST, FIRST" format
  // Split on comma, reverse, take first word
  const rawName = report.applicant.name ?? "";
  const nameParts = rawName.split(",").map((p) => p.trim()).reverse();
  const fullNameWords = nameParts.join(" ").split(/\s+/).filter(Boolean);
  const firstName = fullNameWords[0] ?? null;
  results.push(
    result("guarantorFirstName", firstName, report.applicant.boundingBoxes.name),
  );

  // 4. guarantorLastName – remaining words after reversing
  const lastName = fullNameWords.length > 1 ? fullNameWords.slice(1).join(" ") : null;
  results.push(
    result("guarantorLastName", lastName, report.applicant.boundingBoxes.name),
  );

  // 5. guarantorAddress
  results.push(
    result(
      "guarantorAddress",
      report.applicant.currentAddress,
      report.applicant.boundingBoxes.currentAddress,
    ),
  );

  // 6. ssn
  results.push(
    result("ssn", report.applicant.ssn, report.applicant.boundingBoxes.ssn),
  );

  // 7. coApplicantName
  results.push(
    result(
      "coApplicantName",
      report.coApplicant?.name ?? null,
      report.coApplicant?.boundingBoxes?.name,
    ),
  );

  // 8. equifaxScore
  const efx = findScoreByBureau(report.scoreModels, "EQUIFAX", "EFX");
  results.push(
    result(
      "equifaxScore",
      efx?.score != null ? String(efx.score) : null,
      efx?.boundingBoxes?.score,
    ),
  );

  // 9. transUnionScore
  const tu = findScoreByBureau(report.scoreModels, "TRANSUNION", "TU");
  results.push(
    result(
      "transUnionScore",
      tu?.score != null ? String(tu.score) : null,
      tu?.boundingBoxes?.score,
    ),
  );

  // 10. experianScore
  const xpn = findScoreByBureau(report.scoreModels, "EXPERIAN", "XPN");
  results.push(
    result(
      "experianScore",
      xpn?.score != null ? String(xpn.score) : null,
      xpn?.boundingBoxes?.score,
    ),
  );

  // 11-19: summary fields from raw lines
  const summary = extractSummaryFields(allLines);

  results.push(summary.openTrade);           // 11
  results.push(summary.monthlyObligations);  // 12
  results.push(summary.creditUtilization);   // 13
  results.push(summary.totalDebtHighCredit); // 14
  results.push(summary.delinquencies);       // 15
  results.push(summary.bankruptcy);          // 16
  results.push(summary.inquiries);           // 17
  results.push(summary.liensJudgments);      // 18
  results.push(summary.inquiriesLast12Months); // 19

  return results;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function parsePCBForTextractFromLines(allLines: TextLine[]): PCBParseResult {
  const report = parsePCBFromLines(allLines);
  return { results: buildResults(report, allLines), report };
}

export async function parsePCBForTextract(buffer: Buffer): Promise<PCBParseResult> {
  const allLines = await extractLines(buffer);
  return parsePCBForTextractFromLines(allLines);
}
