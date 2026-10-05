import { toBBox } from "@parseo/shared";
import type { TextLine, BoundingBox } from "@parseo/shared";
import { resolveCheckbox } from "../form-1004mc/extract-checkboxes.js";
import type { CheckedPosition } from "../form-1004mc/extract-checkboxes.js";
import type { CostApproachSection, AppraiserInfo, LenderClientInfo } from "./types.js";

function parseNum(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,%()]/g, "").replace(/,/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
}

function findLine(lines: TextLine[], pattern: RegExp): TextLine | undefined {
  return lines.find((l) => pattern.test(l.fullText));
}

/** Number in the right-hand "=$" result column (x >= 505). */
function resultNum(line: TextLine | undefined): number | null {
  if (!line) return null;
  const seg = line.segments.find((s) => s.x >= 505 && /[\d,]/.test(s.text));
  return seg ? parseNum(seg.text) : null;
}

// ── Additional Comments (Page 4 top) ─────────────────────────────────────

export function parseAdditionalComments(lines: TextLine[]): string {
  const parts: string[] = [];
  for (const l of lines) {
    if (/COST APPROACH TO VALUE/i.test(l.fullText)) break;
    if (l.y < 44 || l.y > 410) continue;
    if (/Small Residential Income|CF1016|File #/i.test(l.fullText)) continue;
    const t = l.fullText.replace(/^ADDITIONAL COMMENTS/i, "").trim();
    if (t) parts.push(t);
  }
  return parts.join(" ").trim();
}

// ── Cost Approach (Page 4) ───────────────────────────────────────────────

export function parseCostApproachSection(lines: TextLine[], checked: CheckedPosition[]): CostApproachSection {
  const bb: Record<string, BoundingBox> = {};

  const basisLine = findLine(lines, /REPLACEMENT COST NEW/i);
  const costBasisType = (basisLine ? resolveCheckbox(checked, basisLine.y, [
    { x: 127, label: "Reproduction" },
    { x: 193, label: "Replacement" },
  ]) : "") as CostApproachSection["costBasisType"];

  // Case-sensitive: the grid label is all-caps ("OPINION OF SITE VALUE"),
  // distinct from the lowercase "opinion of site value" support-text line.
  const siteLine = findLine(lines, /OPINION OF SITE VALUE/);
  const opinionOfSiteValue = resultNum(siteLine);

  const dwellingLine = findLine(lines, /^DWELLING/i) ?? lines.find((l) => l.segments.some((s) => /^DWELLING/i.test(s.text)));
  let dwellingSqft: number | null = null, dwellingCostPerSqft: number | null = null, dwellingCost: number | null = null;
  if (dwellingLine) {
    const m = dwellingLine.fullText.match(/([\d,]+)\s*Sq\.Ft\.\s*@\s*\$\s*([\d,.]+)/i);
    if (m) { dwellingSqft = parseNum(m[1]); dwellingCostPerSqft = parseNum(m[2]); }
    dwellingCost = resultNum(dwellingLine);
  }

  const sourceLine = findLine(lines, /^Source of cost data/i);
  const sourceOfCostData = sourceLine
    ? (sourceLine.segments.find((s) => s.x > 130 && s.x < 300)?.text.trim() ?? "")
    : "";

  const qualityLine = findLine(lines, /^Quality rating from cost service/i);
  let qualityRating = "", effectiveDateOfCostData = "";
  if (qualityLine) {
    const seg = qualityLine.segments.find((s) => s.x > 155 && s.x < 260);
    if (seg) qualityRating = seg.text.replace(/Effective date.*/i, "").trim();
    const dateM = qualityLine.fullText.match(/Effective date of cost data\s+(\S+)/i);
    if (dateM) effectiveDateOfCostData = dateM[1];
  }

  const garageLine = findLine(lines, /^Garage\/Carport/i);
  let garageCarportSqft: number | null = null, garageCarportCost: number | null = null;
  if (garageLine) {
    const m = garageLine.fullText.match(/([\d,]+)\s*Sq\.Ft\.\s*@\s*\$\s*([\d,.]+)/i);
    if (m) garageCarportSqft = parseNum(m[1]);
    garageCarportCost = resultNum(garageLine);
  }

  const totalEstimateOfCostNew = resultNum(findLine(lines, /Total Estimate of Cost-New/i));
  const depreciation = resultNum(findLine(lines, /^Depreciation/i));
  const depreciatedCostOfImprovements = resultNum(findLine(lines, /Depreciated Cost of Improvements/i));
  const asIsValueOfSiteImprovements = resultNum(findLine(lines, /"As-is" Value of Site Improvements|As-is.*Value of Site Improvements/i));
  const indicatedValueByCostApproach = resultNum(findLine(lines, /INDICATED VALUE BY COST APPROACH/i));

  const erelLine = findLine(lines, /Estimated Remaining Economic Life/i);
  let estimatedRemainingEconomicLife: number | null = null;
  if (erelLine) {
    const m = erelLine.fullText.match(/Estimated Remaining Economic Life[^\d]*(\d+)\s*Years/i);
    if (m) estimatedRemainingEconomicLife = parseNum(m[1]);
  }

  // Site-value support text
  const supportLine = findLine(lines, /^Support for the opinion of site value/i);
  let supportForOpinionOfSiteValue = "";
  if (supportLine) {
    const idx = lines.indexOf(supportLine);
    const valueSeg = supportLine.segments.find((s) => s.x > 370);
    const parts: string[] = [];
    if (valueSeg) parts.push(valueSeg.text.trim());
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^ESTIMATED\b/i.test(lines[i].fullText)) break;
      const seg = lines[i].segments.find((s) => s.x < 300);
      if (seg) parts.push(seg.text.trim());
    }
    supportForOpinionOfSiteValue = parts.join(" ").trim();
  }

  // Left-column comments ("Comments on Cost Approach ...")
  const commentsLine = findLine(lines, /^Comments on Cost Approach/i);
  let comments = "";
  if (commentsLine) {
    const idx = lines.indexOf(commentsLine);
    const parts: string[] = [];
    for (let i = idx + 1; i < lines.length; i++) {
      if (/PROJECT INFORMATION FOR PUDs/i.test(lines[i].fullText)) break;
      // x >= 80 skips the rotated sidebar section label ("COST APPROACH" at x≈78)
      const seg = lines[i].segments.find((s) => s.x >= 80 && s.x < 300);
      if (seg) parts.push(seg.text.trim());
    }
    comments = parts.join(" ").trim();
  }

  return {
    costBasisType, supportForOpinionOfSiteValue, opinionOfSiteValue, sourceOfCostData,
    qualityRating, effectiveDateOfCostData, dwellingSqft, dwellingCostPerSqft, dwellingCost,
    garageCarportSqft, garageCarportCost, totalEstimateOfCostNew, depreciation,
    depreciatedCostOfImprovements, asIsValueOfSiteImprovements, indicatedValueByCostApproach,
    estimatedRemainingEconomicLife, comments, boundingBoxes: bb,
  };
}

// ── Appraiser / Lender (Page 7) ──────────────────────────────────────────

export function parseAppraiserInfo(lines: TextLine[], supervisory: boolean): AppraiserInfo | null {
  const bb: Record<string, BoundingBox> = {};
  const xMin = supervisory ? 300 : 0;
  const xMax = supervisory ? 600 : 300;

  function getField(label: RegExp): string {
    for (const l of lines) {
      const seg = l.segments.find((s) => s.x >= xMin && s.x < xMax && label.test(s.text));
      if (!seg) continue;
      const after = seg.text.replace(label, "").trim();
      if (after) return after;
      const next = l.segments.find((s) => s.x > seg.x && s.x < xMax && !label.test(s.text));
      if (next) return next.text.trim();
    }
    return "";
  }

  const name = getField(/^Name\s*/i);
  if (supervisory && !name) return null;

  // Company address may wrap to the next line
  const addrLine = lines.find((l) => l.segments.some((s) => s.x >= xMin && s.x < xMax && /^Company Address/i.test(s.text)));
  let companyAddress = getField(/^Company Address\s*/i);
  if (addrLine) {
    const idx = lines.indexOf(addrLine);
    const next = lines[idx + 1];
    const nextSeg = next?.segments.find((s) => s.x >= xMin && s.x < xMax && !/^(Telephone|Email|Date|Effective|State|or |Expiration)/i.test(s.text));
    if (nextSeg && /,/.test(nextSeg.text)) companyAddress += ` ${nextSeg.text.trim()}`;
  }

  const nameLine = lines.find((l) => l.segments.some((s) => s.x >= xMin && s.x < xMax && /^Name\s/i.test(s.text)));
  if (nameLine) {
    const seg = nameLine.segments.find((s) => s.x >= xMin && s.x < xMax && /^Name\s/i.test(s.text));
    if (seg) bb.name = toBBox(seg, nameLine);
  }

  // State: a "State XX" segment holding a 2-letter code (avoid the empty
  // "State #" placeholder from the "or Other (describe)  State #" row).
  let state = "";
  for (const l of lines) {
    const seg = l.segments.find((s) => s.x >= xMin && s.x < xMax && /^State\s+[A-Za-z]{2}\b/.test(s.text));
    if (seg) { state = seg.text.replace(/^State\s+/i, "").trim(); break; }
  }

  return {
    name,
    companyName: getField(/^Company Name\s*/i),
    companyAddress: companyAddress.trim(),
    telephoneNumber: getField(/^Telephone Number\s*/i),
    emailAddress: getField(/^Email Address\s*/i),
    dateOfSignature: getField(/^Date of Signature( and Report)?\s*/i),
    effectiveDateOfAppraisal: getField(/^Effective Date of Appraisal\s*/i),
    stateCertification: getField(/^State Certification #\s*/i),
    stateOrLicense: getField(/^or State License #\s*/i),
    state,
    expirationDate: getField(/^Expiration Date of Certification or License\s*/i),
    boundingBoxes: bb,
  };
}

export function parseLenderClientInfo(lines: TextLine[]): LenderClientInfo {
  const bb: Record<string, BoundingBox> = {};

  const header = findLine(lines, /^LENDER\/CLIENT$/i);
  const startY = header?.y ?? 0;
  const lenderLines = lines.filter((l) => l.y >= startY && l.segments.some((s) => s.x < 300));

  function getField(label: RegExp): string {
    for (const l of lenderLines) {
      const seg = l.segments.find((s) => s.x < 300 && label.test(s.text));
      if (!seg) continue;
      const after = seg.text.replace(label, "").trim();
      if (after) return after;
      const next = l.segments.find((s) => s.x > seg.x && s.x < 300 && !label.test(s.text));
      if (next) return next.text.trim();
    }
    return "";
  }

  let companyAddress = getField(/^Company Address\s*/i);
  const addrLine = lenderLines.find((l) => l.segments.some((s) => s.x < 300 && /^Company Address/i.test(s.text)));
  if (addrLine) {
    const idx = lines.indexOf(addrLine);
    const next = lines[idx + 1];
    const nextSeg = next?.segments.find((s) => s.x < 300 && !/^Email/i.test(s.text));
    if (nextSeg && /,/.test(nextSeg.text)) companyAddress += ` ${nextSeg.text.trim()}`;
  }

  // Address of property appraised
  const apLine = findLine(lines, /ADDRESS OF PROPERTY APPRAISED/i);
  let addressOfPropertyAppraised = "";
  if (apLine) {
    const idx = lines.indexOf(apLine);
    const parts: string[] = [];
    for (let i = idx + 1; i < lines.length; i++) {
      if (/APPRAISED VALUE OF SUBJECT/i.test(lines[i].fullText)) break;
      const seg = lines[i].segments.find((s) => s.x < 300);
      if (seg) parts.push(seg.text.trim());
    }
    addressOfPropertyAppraised = parts.join(", ").trim();
  }

  const valLine = findLine(lines, /APPRAISED VALUE OF SUBJECT PROPERTY/i);
  let appraisedValueOfSubjectProperty: number | null = null;
  if (valLine) {
    const seg = valLine.segments.find((s) => s.x > 200 && /[\d,]/.test(s.text));
    if (seg) appraisedValueOfSubjectProperty = parseNum(seg.text);
  }

  return {
    name: getField(/^Name\s*/i),
    companyName: getField(/^Company Name\s*/i),
    companyAddress: companyAddress.trim(),
    emailAddress: getField(/^Email Address\s*/i),
    addressOfPropertyAppraised,
    appraisedValueOfSubjectProperty,
    boundingBoxes: bb,
  };
}
