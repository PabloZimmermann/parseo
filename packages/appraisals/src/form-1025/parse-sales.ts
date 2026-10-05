import { toBBox } from "@parseo/shared";
import type { TextLine, BoundingBox } from "@parseo/shared";
import { resolveCheckbox } from "../form-1004mc/extract-checkboxes.js";
import type { CheckedPosition } from "../form-1004mc/extract-checkboxes.js";
import type {
  SalesComparisonSection,
  SalesComparisonSubject,
  ComparableSale,
  IncomeSection,
  ReconciliationSection,
} from "./types.js";

// ── Utilities ────────────────────────────────────────────────────────────

function parseNum(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,%]/g, "").replace(/,/g, "").trim();
  if (!cleaned || /^n\/?a$/i.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
}

function findLine(lines: TextLine[], pattern: RegExp): TextLine | undefined {
  return lines.find((l) => pattern.test(l.fullText));
}

function colText(line: TextLine | undefined, min: number, max: number): string {
  if (!line) return "";
  return line.segments
    .filter((s) => s.x >= min && s.x < max)
    .map((s) => s.text.trim())
    .join(" ")
    .trim();
}

function colNum(line: TextLine | undefined, min: number, max: number): number | null {
  const t = colText(line, min, max).replace(/\$/g, "");
  const m = t.match(/-?[\d,]+(?:\.\d+)?/);
  return m ? parseNum(m[0]) : null;
}

// Full comp columns (single-value rows) and desc/adj columns (adjustment rows)
const SUBJECT = { min: 108, max: 215 };
const COMP_FULL = [
  { min: 216, max: 341 },
  { min: 324, max: 449 },
  { min: 432, max: 545 },
];
const COMP_DESC = [
  { min: 216, max: 290 },
  { min: 324, max: 398 },
  { min: 432, max: 505 },
];
const COMP_ADJ = [
  { min: 290, max: 341 },
  { min: 398, max: 449 },
  { min: 505, max: 545 },
];
const RENT_CONTROL_OPTS = [
  [{ x: 229, label: "Yes" }, { x: 253, label: "No" }],
  [{ x: 337, label: "Yes" }, { x: 360, label: "No" }],
  [{ x: 444, label: "Yes" }, { x: 468, label: "No" }],
];

function parseComparable(
  lines: TextLine[],
  checked: CheckedPosition[],
  number: number,
  full: { min: number; max: number },
  desc: { min: number; max: number },
  adj: { min: number; max: number },
  rentControlOpts: { x: number; label: string }[],
): ComparableSale {
  const bb: Record<string, BoundingBox> = {};

  const addrLine = findLine(lines, /^Address/i);
  let address = colText(addrLine, desc.min, desc.max);
  if (addrLine) {
    const idx = lines.indexOf(addrLine);
    const cityLine = lines[idx + 1];
    const city = colText(cityLine, desc.min, desc.max);
    if (city) address = `${address}, ${city}`;
    const seg = addrLine.segments.find((s) => s.x >= desc.min && s.x < desc.max);
    if (seg) bb.address = toBBox(seg, addrLine);
  }

  const rcLine = findLine(lines, /^Rent Control/i);
  const rentControl = rcLine ? resolveCheckbox(checked, rcLine.y, rentControlOpts) : "";

  const ppsLine = findLine(lines, /^Sale Price\/Gross Bldg\. Area/i);
  let salePricePerGBA: number | null = null;
  if (ppsLine) {
    const m = colText(ppsLine, full.min, full.max).match(/([\d.]+)\s*sq/i);
    if (m) salePricePerGBA = parseNum(m[1]);
  }

  const netLine = findLine(lines, /^Net Adjustment \(Total\)/i);
  const netAdjustmentTotal = netLine ? colNum(netLine, adj.min, adj.max) : null;

  const netPctLine = findLine(lines, /^Adjusted Sale Price/i);
  let netAdjustmentPercent: number | null = null;
  if (netPctLine) {
    const m = colText(netPctLine, full.min, full.max).match(/([\d.]+)\s*%/);
    if (m) netAdjustmentPercent = parseNum(m[1]);
  }

  const grossLine = findLine(lines, /^of Comparables/i);
  let grossAdjustmentPercent: number | null = null, adjustedSalePrice: number | null = null;
  if (grossLine) {
    const t = colText(grossLine, full.min, full.max);
    const pct = t.match(/([\d.]+)\s*%/);
    if (pct) grossAdjustmentPercent = parseNum(pct[1]);
    const price = t.match(/\$\s*([\d,]+)/);
    if (price) adjustedSalePrice = parseNum(price[1]);
  }

  return {
    number,
    address,
    proximityToSubject: colText(findLine(lines, /^Proximity to Subject/i), desc.min, desc.max),
    salePrice: colNum(findLine(lines, /^Sale Price\b/i), full.min, full.max),
    salePricePerGBA,
    grossMonthlyRent: colNum(findLine(lines, /^Gross Monthly Rent/i), full.min, full.max),
    grossRentMultiplier: colNum(findLine(lines, /^Gross Rent Multiplier/i), full.min, full.max),
    pricePerUnit: colNum(findLine(lines, /^Price per Unit/i), full.min, full.max),
    pricePerRoom: colNum(findLine(lines, /^Price per Room/i), full.min, full.max),
    pricePerBedroom: colNum(findLine(lines, /^Price per Bedroom/i), full.min, full.max),
    rentControl,
    dataSources: colText(findLine(lines, /^Data Source\(s\)/i), desc.min, desc.max),
    verificationSources: colText(findLine(lines, /^Verification Source/i), desc.min, desc.max),
    saleOrFinancing: colText(findLine(lines, /^Sale or Financing/i), desc.min, desc.max),
    concessions: colText(findLine(lines, /^Concessions/i), desc.min, desc.max),
    dateOfSaleTime: colText(findLine(lines, /^Date of Sale\/Time/i), desc.min, desc.max),
    location: colText(findLine(lines, /^Location\b/i), desc.min, desc.max),
    leaseholdFeeSimple: colText(findLine(lines, /^Leasehold\/Fee Simple/i), desc.min, desc.max),
    site: colText(findLine(lines, /^Site\b/i), desc.min, desc.max),
    siteAdjustment: colNum(findLine(lines, /^Site\b/i), adj.min, adj.max),
    view: colText(findLine(lines, /^View\b/i), desc.min, desc.max),
    viewAdjustment: colNum(findLine(lines, /^View\b/i), adj.min, adj.max),
    designStyle: colText(findLine(lines, /^Design \(Style\)/i), desc.min, desc.max),
    qualityOfConstruction: colText(findLine(lines, /^Quality of Construction/i), desc.min, desc.max),
    actualAge: colNum(findLine(lines, /^Actual Age/i), desc.min, desc.max),
    condition: colText(findLine(lines, /^Condition\b/i), desc.min, desc.max),
    grossBuildingArea: colNum(findLine(lines, /^Gross Building Area/i), desc.min, desc.max),
    grossBuildingAreaAdjustment: colNum(findLine(lines, /^Gross Building Area/i), adj.min, adj.max),
    functionalUtility: colText(findLine(lines, /^Functional Utility/i), desc.min, desc.max),
    heatingCooling: colText(findLine(lines, /^Heating\/Cooling/i), desc.min, desc.max),
    energyEfficientItems: colText(findLine(lines, /^Energy Efficient Items/i), desc.min, desc.max),
    parkingOnOffSite: colText(findLine(lines, /^Parking On\/Off Site/i), desc.min, desc.max),
    porchPatioDeck: colText(findLine(lines, /^Porch\/Patio\/Deck/i), desc.min, desc.max),
    appliancesFireplaces: colText(findLine(lines, /^Appliances\/Fireplaces/i), desc.min, desc.max),
    netAdjustmentTotal, netAdjustmentPercent, grossAdjustmentPercent, adjustedSalePrice,
    boundingBoxes: bb,
  };
}

export function parseSalesComparisonSection(lines: TextLine[], checked: CheckedPosition[]): SalesComparisonSection {
  const bb: Record<string, BoundingBox> = {};

  const alLine = findLine(lines, /comparable properties currently offered/i);
  let activeListingsCount: number | null = null, activeListingsLow: number | null = null, activeListingsHigh: number | null = null;
  if (alLine) {
    const c = alLine.fullText.match(/There are\s+(\d+)\s+comparable properties/i);
    if (c) activeListingsCount = parseNum(c[1]);
    const r = alLine.fullText.match(/\$\s*([\d,]+)\s*to \$\s*([\d,]+)/i);
    if (r) { activeListingsLow = parseNum(r[1]); activeListingsHigh = parseNum(r[2]); }
  }

  const csLine = findLine(lines, /comparable sales in the subject neighborhood/i);
  let comparableSalesCount: number | null = null, comparableSalesLow: number | null = null, comparableSalesHigh: number | null = null;
  if (csLine) {
    const c = csLine.fullText.match(/There are\s+(\d+)\s+comparable sales/i);
    if (c) comparableSalesCount = parseNum(c[1]);
    const r = csLine.fullText.match(/\$\s*([\d,]+)\s*to \$\s*([\d,]+)/i);
    if (r) { comparableSalesLow = parseNum(r[1]); comparableSalesHigh = parseNum(r[2]); }
  }

  const addrLine = findLine(lines, /^Address/i);
  let subjAddress = "";
  if (addrLine) {
    const seg = addrLine.segments.find((s) => /^Address\s/i.test(s.text));
    if (seg) { subjAddress = seg.text.replace(/^Address\s+/i, "").trim(); bb.address = toBBox(seg, addrLine); }
    const idx = lines.indexOf(addrLine);
    const cityLine = lines[idx + 1];
    const city = colText(cityLine, SUBJECT.min, SUBJECT.max);
    if (city) subjAddress = `${subjAddress}, ${city}`;
  }

  const ppsLine = findLine(lines, /^Sale Price\/Gross Bldg\. Area/i);
  let subjPPS: number | null = null;
  if (ppsLine) {
    const m = colText(ppsLine, SUBJECT.min, SUBJECT.max).match(/([\d.]+)\s*sq/i);
    if (m) subjPPS = parseNum(m[1]);
  }

  const subject: SalesComparisonSubject = {
    address: subjAddress,
    salePrice: colNum(findLine(lines, /^Sale Price\b/i), SUBJECT.min, SUBJECT.max),
    salePricePerGBA: subjPPS,
    grossMonthlyRent: colNum(findLine(lines, /^Gross Monthly Rent/i), SUBJECT.min, SUBJECT.max),
    location: colText(findLine(lines, /^Location\b/i), SUBJECT.min, SUBJECT.max),
    leaseholdFeeSimple: colText(findLine(lines, /^Leasehold\/Fee Simple/i), SUBJECT.min, SUBJECT.max),
    site: colText(findLine(lines, /^Site\b/i), SUBJECT.min, SUBJECT.max),
    view: colText(findLine(lines, /^View\b/i), SUBJECT.min, SUBJECT.max),
    designStyle: colText(findLine(lines, /^Design \(Style\)/i), SUBJECT.min, SUBJECT.max),
    qualityOfConstruction: colText(findLine(lines, /^Quality of Construction/i), SUBJECT.min, SUBJECT.max),
    actualAge: colNum(findLine(lines, /^Actual Age/i), SUBJECT.min, SUBJECT.max),
    condition: colText(findLine(lines, /^Condition\b/i), SUBJECT.min, SUBJECT.max),
    grossBuildingArea: colNum(findLine(lines, /^Gross Building Area/i), SUBJECT.min, SUBJECT.max),
    functionalUtility: colText(findLine(lines, /^Functional Utility/i), SUBJECT.min, SUBJECT.max),
    heatingCooling: colText(findLine(lines, /^Heating\/Cooling/i), SUBJECT.min, SUBJECT.max),
    energyEfficientItems: colText(findLine(lines, /^Energy Efficient Items/i), SUBJECT.min, SUBJECT.max),
    parkingOnOffSite: colText(findLine(lines, /^Parking On\/Off Site/i), SUBJECT.min, SUBJECT.max),
    porchPatioDeck: colText(findLine(lines, /^Porch\/Patio\/Deck/i), SUBJECT.min, SUBJECT.max),
    boundingBoxes: {},
  };

  const comparables: ComparableSale[] = [];
  for (let i = 0; i < 3; i++) {
    comparables.push(parseComparable(lines, checked, i + 1, COMP_FULL[i], COMP_DESC[i], COMP_ADJ[i], RENT_CONTROL_OPTS[i]));
  }

  const sumLine = findLine(lines, /^Summary of Sales Comparison Approach/i);
  let summaryOfSalesComparison = "";
  if (sumLine) {
    const idx = lines.indexOf(sumLine);
    const valueSeg = sumLine.segments.find((s) => s.x > 340);
    const parts: string[] = [];
    if (valueSeg) parts.push(valueSeg.text.trim());
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^Indicated Value by Sales Comparison/i.test(lines[i].fullText)) break;
      const t = lines[i].fullText.trim();
      if (t) parts.push(t);
    }
    summaryOfSalesComparison = parts.join(" ").trim();
    if (sumLine.segments[0]) bb.summaryOfSalesComparison = toBBox(sumLine.segments[0], sumLine);
  }

  const indLine = findLine(lines, /^Indicated Value by Sales Comparison Approach\s*\$/i);
  let indicatedValueBySalesComparison: number | null = null;
  if (indLine) {
    const seg = indLine.segments.find((s) => s.x > 150 && /^[\d,]+$/.test(s.text.trim()));
    if (seg) { indicatedValueBySalesComparison = parseNum(seg.text); bb.indicatedBySales = toBBox(seg, indLine); }
  }

  return {
    activeListingsCount, activeListingsLow, activeListingsHigh,
    comparableSalesCount, comparableSalesLow, comparableSalesHigh,
    subject, comparables, summaryOfSalesComparison, indicatedValueBySalesComparison,
    boundingBoxes: bb,
  };
}

// ── Income Approach (Page 3) ─────────────────────────────────────────────

export function parseIncomeSection(lines: TextLine[]): IncomeSection {
  const bb: Record<string, BoundingBox> = {};

  const grmLine = findLine(lines, /Total gross monthly rent/i);
  let totalGrossMonthlyRent: number | null = null, grossRentMultiplier: number | null = null, indicatedValueByIncomeApproach: number | null = null;
  if (grmLine) {
    const t = grmLine.fullText;
    const rent = t.match(/Total gross monthly rent \$\s*([\d,]+)/i);
    if (rent) { totalGrossMonthlyRent = parseNum(rent[1]); bb.totalGrossMonthlyRent = toBBox(grmLine.segments[0], grmLine); }
    const grm = t.match(/\(GRM\)\s*([\d,.]+)/i);
    if (grm) grossRentMultiplier = parseNum(grm[1]);
    const val = t.match(/=\s*\$\s*([\d,]+)/);
    if (val) indicatedValueByIncomeApproach = parseNum(val[1]);
  }

  const commentsLine = findLine(lines, /^Comments on income approach/i);
  let comments = "";
  if (commentsLine) {
    const idx = lines.indexOf(commentsLine);
    const valueSeg = commentsLine.segments.find((s) => s.x > 250);
    const parts: string[] = [];
    if (valueSeg) parts.push(valueSeg.text.trim());
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^Indicated Value by:/i.test(lines[i].fullText)) break;
      const t = lines[i].fullText.trim();
      if (t) parts.push(t);
    }
    comments = parts.join(" ").trim();
  }

  return { totalGrossMonthlyRent, grossRentMultiplier, indicatedValueByIncomeApproach, comments, boundingBoxes: bb };
}

// ── Reconciliation (Page 3 bottom) ───────────────────────────────────────

export function parseReconciliationSection(lines: TextLine[], checked: CheckedPosition[]): ReconciliationSection {
  const bb: Record<string, BoundingBox> = {};

  const indLine = findLine(lines, /^Indicated Value by:/i);
  let indicatedValueBySalesComparison: number | null = null, indicatedValueByIncomeApproach: number | null = null, indicatedValueByCostApproach: number | null = null;
  if (indLine) {
    const t = indLine.fullText;
    const sc = t.match(/Sales Comparison Approach \$\s*([\d,]+)/i);
    if (sc) { indicatedValueBySalesComparison = parseNum(sc[1]); bb.indicatedBySales = toBBox(indLine.segments[0], indLine); }
    const inc = t.match(/Income Approach \$\s*([\d,]+)/i);
    if (inc) indicatedValueByIncomeApproach = parseNum(inc[1]);
    const cost = t.match(/Cost Approach \(if developed\) \$\s*([\d,]+)/i);
    if (cost) indicatedValueByCostApproach = parseNum(cost[1]);
  }

  // Reconciliation comments (between the Indicated Value line and the basis line)
  const idxInd = indLine ? lines.indexOf(indLine) : -1;
  const basisLine = findLine(lines, /^This appraisal is made/i);
  const idxBasis = basisLine ? lines.indexOf(basisLine) : lines.length;
  const commentParts: string[] = [];
  if (idxInd >= 0) {
    for (let i = idxInd + 1; i < idxBasis; i++) {
      const t = lines[i].fullText.trim();
      if (t) commentParts.push(t);
    }
  }
  const reconciliationComments = commentParts.join(" ").trim();

  // Basis checkbox → tells whether finalValue is an "as is" value or a
  // subject-to (as-completed / ARV) value. The four options span wrapped lines
  // and the form's x-origin shifts between documents, so derive each option's
  // x from its own text segment instead of hardcoding positions.
  let appraisalBasisType: ReconciliationSection["appraisalBasisType"] = "";
  const basisStart = basisLine ? lines.indexOf(basisLine) : -1;
  if (basisStart >= 0) {
    const basisBlock = lines.slice(basisStart, basisStart + 4);
    const basisOptions = [
      { type: "as is", re: /^\W*as is\b/i },
      { type: "subject to completion", re: /^subject to completion/i },
      { type: "subject to repairs", re: /^subject to the following repairs/i },
      { type: "subject to inspection", re: /^subject to the$|following required inspection/i },
    ] as const;
    for (const opt of basisOptions) {
      const match = basisBlock
        .map((line) => ({ line, seg: line.segments.find((s) => opt.re.test(s.text.trim())) }))
        .find((m) => m.seg);
      if (match?.seg && resolveCheckbox(checked, match.line.y, [{ x: match.seg.x, label: opt.type }])) {
        appraisalBasisType = opt.type;
        bb.appraisalBasisType = toBBox(match.seg, match.line);
        break;
      }
    }
  }

  // Appraisal basis narrative
  let appraisalBasis = "";
  if (basisLine) {
    const idx = lines.indexOf(basisLine);
    const parts: string[] = [];
    for (let i = idx; i < lines.length; i++) {
      if (/^Based on a complete visual inspection/i.test(lines[i].fullText)) break;
      parts.push(lines[i].fullText.trim());
    }
    appraisalBasis = parts.join(" ").replace(/^This appraisal is made\s*/i, "").trim();
  }

  const valueLine = findLine(lines, /^\$\s*[\d,]+\s*,\s*as of/i);
  let finalValue: number | null = null, effectiveDate = "";
  if (valueLine) {
    const m = valueLine.fullText.match(/^\$\s*([\d,]+)\s*,\s*as of\s+(\S+)/i);
    if (m) {
      finalValue = parseNum(m[1]);
      effectiveDate = m[2];
      bb.finalValue = toBBox(valueLine.segments[0], valueLine);
    }
  }

  return {
    indicatedValueBySalesComparison, indicatedValueByIncomeApproach, indicatedValueByCostApproach,
    reconciliationComments, appraisalBasis, appraisalBasisType, finalValue, effectiveDate,
    boundingBoxes: bb,
  };
}
