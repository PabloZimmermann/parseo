import { toBBox } from "@parseo/shared";
import type { TextLine, BoundingBox } from "@parseo/shared";
import type {
  SalesComparisonSection,
  SalesComparisonSubject,
  ComparableSale,
  ReconciliationSection,
  AppraiserInfo,
  LenderClientInfo,
} from "./types.js";

// ── Utilities ────────────────────────────────────────────────────────────

function parseNum(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,%]/g, "").replace(/,/g, "").trim();
  if (!cleaned || /^n\/?a$/i.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
}

function parseCurrency(raw: string): number | null {
  const match = raw.match(/\$?\s*([\d,]+(?:\.\d+)?)/);
  return match ? parseNum(match[1]) : null;
}

// Column x-boundaries for Form 1073 sales comparison grid
// Derived from segment positions in the sample PDF
const SUBJECT_X = { min: 114, max: 180 };
const COMP_COLS = [
  { desc: { min: 180, max: 260 }, adj: { min: 260, max: 313 } },
  { desc: { min: 313, max: 392 }, adj: { min: 392, max: 444 } },
  { desc: { min: 444, max: 524 }, adj: { min: 524, max: 580 } },
];

function segInRange(line: TextLine, min: number, max: number): string {
  const segs = line.segments.filter((s) => s.x >= min && s.x < max);
  return segs.map((s) => s.text.trim()).join(" ").trim();
}

function segWithBBox(line: TextLine, min: number, max: number): { text: string; seg: typeof line.segments[0] | null } {
  const seg = line.segments.find((s) => s.x >= min && s.x < max);
  return { text: seg ? seg.text.trim() : "", seg: seg ?? null };
}

function findLine(lines: TextLine[], pattern: RegExp): TextLine | undefined {
  return lines.find((l) => pattern.test(l.fullText));
}

// ── Parse single comparable from a column ────────────────────────────────

function parseComparable(
  lines: TextLine[],
  compNum: number,
  col: typeof COMP_COLS[0],
): ComparableSale {
  const bb: Record<string, BoundingBox> = {};
  const prefix = `comp${compNum}`;

  function getDesc(line: TextLine | undefined): string {
    return line ? segInRange(line, col.desc.min, col.adj.min) : "";
  }
  function getAdj(line: TextLine | undefined): number | null {
    if (!line) return null;
    const text = segInRange(line, col.adj.min, col.adj.min + 60);
    return parseNum(text);
  }
  function getDescWithBB(line: TextLine | undefined, key: string): string {
    if (!line) return "";
    const r = segWithBBox(line, col.desc.min, col.adj.min);
    if (r.seg) bb[`${prefix}_${key}`] = toBBox(r.seg, line);
    return r.text;
  }

  const addrLine = findLine(lines, /^Address/i);
  const address = getDescWithBB(addrLine, "address");
  const addrIdx = addrLine ? lines.indexOf(addrLine) : -1;
  const cityLine = addrIdx >= 0 ? lines[addrIdx + 1] : undefined;
  const cityVal = cityLine ? segInRange(cityLine, col.desc.min, col.adj.min) : "";

  const projLine = findLine(lines, /^Project Name/i);
  const projectNamePhase = getDesc(projLine);

  const proxLine = findLine(lines, /^Proximity to Subject/i);
  const proximityToSubject = getDescWithBB(proxLine, "proximity");

  const priceLine = findLine(lines, /^Sale Price\b/i);
  let salePrice: number | null = null;
  if (priceLine) {
    const priceText = segInRange(priceLine, col.desc.min - 30, col.adj.min);
    salePrice = parseCurrency(priceText);
    const pSeg = segWithBBox(priceLine, col.desc.min, col.adj.min);
    if (pSeg.seg) bb[`${prefix}_salePrice`] = toBBox(pSeg.seg, priceLine);
  }

  const ppsLine = findLine(lines, /^Sale Price\/Gross Liv/i);
  let salePricePerSqft: number | null = null;
  if (ppsLine) {
    const txt = segInRange(ppsLine, col.desc.min - 30, col.adj.min);
    const m = txt.match(/([\d,.]+)\s*sq\.?\s*ft/i);
    if (m) salePricePerSqft = parseNum(m[1]);
  }

  const dsLine = findLine(lines, /^Data Source\(s\)/i);
  const dataSources = getDescWithBB(dsLine, "dataSources");

  const vsLine = findLine(lines, /^Verification Source/i);
  const verificationSources = getDesc(vsLine);

  const sfLine = findLine(lines, /^Sales or Financing/i);
  const salesOrFinancing = getDesc(sfLine);

  const concLine = findLine(lines, /^Concessions/i);
  const concessions = getDesc(concLine);

  const dateLine = findLine(lines, /^Date of Sale\/Time/i);
  const dateOfSaleTime = getDescWithBB(dateLine, "dateOfSale");

  const locLine = findLine(lines, /^Location\b/i);
  const location = getDesc(locLine);

  const feeLine = findLine(lines, /^Leasehold\/Fee Simple/i);
  const leaseholdFeeSimple = getDesc(feeLine);

  const hoaLine = findLine(lines, /^HOA Mo\. Assessment/i);
  const hoaMoAssessment = hoaLine ? parseNum(getDesc(hoaLine)) : null;

  const commLine = findLine(lines, /^Common Elements/i);
  const commonElements = getDesc(commLine);

  const floorLine = findLine(lines, /^Floor Location/i);
  const floorLocation = getDesc(floorLine);

  const viewLine = findLine(lines, /^View\b/i);
  const view = getDesc(viewLine);

  const styleLine = findLine(lines, /^Design \(Style\)/i);
  const designStyle = getDesc(styleLine);

  const qualLine = findLine(lines, /^Quality of Construction/i);
  const qualityOfConstruction = getDesc(qualLine);

  const ageLine = findLine(lines, /^Actual Age\b/i);
  const actualAge = parseNum(getDesc(ageLine));

  const condLine = findLine(lines, /^Condition\b/i);
  const condition = getDescWithBB(condLine, "condition");
  const conditionAdjustment = getAdj(condLine);

  const rcLine = findLine(lines, /^Room Count/i);
  let roomCountTotal: number | null = null, roomCountBedrooms: number | null = null, roomCountBaths: number | null = null, roomCountAdjustment: number | null = null;
  if (rcLine) {
    const text = segInRange(rcLine, col.desc.min, col.adj.min);
    const parts = text.split(/\s+/).map((s) => parseNum(s)).filter((n) => n !== null);
    if (parts.length >= 3) { roomCountTotal = parts[0]; roomCountBedrooms = parts[1]; roomCountBaths = parts[2]; }
    roomCountAdjustment = getAdj(rcLine);
  }

  const glaLine = findLine(lines, /^Gross Living Area/i);
  let grossLivingArea: number | null = null, grossLivingAreaAdjustment: number | null = null;
  if (glaLine) {
    const text = segInRange(glaLine, col.desc.min - 30, col.adj.min);
    const m = text.match(/([\d,]+)\s*sq/i);
    if (m) grossLivingArea = parseNum(m[1]);
    grossLivingAreaAdjustment = getAdj(glaLine);
    const glaSeg = segWithBBox(glaLine, col.desc.min, col.adj.min);
    if (glaSeg.seg) bb[`${prefix}_gla`] = toBBox(glaSeg.seg, glaLine);
  }

  const bfLine = findLine(lines, /^Basement & Finished/i);
  const basementFinished = getDesc(bfLine);

  const fuLine = findLine(lines, /^Functional Utility/i);
  const functionalUtility = getDesc(fuLine);

  const hcLine = findLine(lines, /^Heating\/Cooling/i);
  const heatingCooling = getDesc(hcLine);

  const eeLine = findLine(lines, /^Energy Efficient/i);
  const energyEfficientItems = getDesc(eeLine);

  const gcLine = findLine(lines, /^Garage\/Carport/i);
  const garageCarport = getDesc(gcLine);

  const ppLine = findLine(lines, /^Porch\/Patio\/Deck/i);
  const porchPatioDeck = getDesc(ppLine);

  // Net/Gross adjustment
  const netLine = findLine(lines, /^Net Adjustment \(Total\)/i);
  let netAdjustmentTotal: number | null = null;
  if (netLine) {
    const text = segInRange(netLine, col.adj.min - 10, col.adj.min + 60);
    netAdjustmentTotal = parseNum(text);
  }

  const adjPriceLine = findLine(lines, /^Adjusted Sale Price/i);
  let netAdjustmentPercent: number | null = null;
  if (adjPriceLine) {
    const text = segInRange(adjPriceLine, col.desc.min, col.adj.min + 20);
    const pctMatch = text.match(/([\d.]+)\s*%/);
    if (pctMatch) netAdjustmentPercent = parseNum(pctMatch[1]);
  }

  const grossLine = findLine(lines, /^of Comparables/i);
  let grossAdjustmentPercent: number | null = null, adjustedSalePrice: number | null = null;
  if (grossLine) {
    const text = segInRange(grossLine, col.desc.min, col.adj.min + 60);
    const pctMatch = text.match(/([\d.]+)\s*%/);
    if (pctMatch) grossAdjustmentPercent = parseNum(pctMatch[1]);
    const priceMatch = text.match(/\$\s*([\d,]+)/);
    if (priceMatch) adjustedSalePrice = parseNum(priceMatch[1]);
  }

  return {
    number: compNum,
    address: address + (cityVal ? `, ${cityVal}` : ""),
    projectNamePhase, proximityToSubject, salePrice, salePricePerSqft,
    dataSources, verificationSources, salesOrFinancing, concessions, dateOfSaleTime,
    location, leaseholdFeeSimple, hoaMoAssessment, commonElements, floorLocation,
    view, designStyle, qualityOfConstruction, actualAge,
    condition, conditionAdjustment,
    roomCountTotal, roomCountBedrooms, roomCountBaths, roomCountAdjustment,
    grossLivingArea, grossLivingAreaAdjustment, basementFinished,
    functionalUtility, heatingCooling, energyEfficientItems, garageCarport, porchPatioDeck,
    netAdjustmentTotal, netAdjustmentPercent, grossAdjustmentPercent, adjustedSalePrice,
    boundingBoxes: bb,
  };
}

// ── Sales Comparison Section ─────────────────────────────────────────────

export function parseSalesComparisonSection(
  lines: TextLine[],
  compStartNum: number = 1,
): SalesComparisonSection {
  const bb: Record<string, BoundingBox> = {};

  // Active listings / comparable sales ranges
  const alLine = findLine(lines, /comparable properties currently offered/i);
  let activeListingsCount: number | null = null, activeListingsLow: number | null = null, activeListingsHigh: number | null = null;
  if (alLine) {
    const countMatch = alLine.fullText.match(/are\s+(\d+)\s+comparable properties/i);
    if (countMatch) activeListingsCount = parseNum(countMatch[1]);
    const rangeMatch = alLine.fullText.match(/\$\s*([\d,]+).*?to\s*\$\s*([\d,]+)/i);
    if (rangeMatch) { activeListingsLow = parseNum(rangeMatch[1]); activeListingsHigh = parseNum(rangeMatch[2]); }
  }

  const csLine = findLine(lines, /comparable sales in the subject/i);
  let comparableSalesCount: number | null = null, comparableSalesLow: number | null = null, comparableSalesHigh: number | null = null;
  if (csLine) {
    const countMatch = csLine.fullText.match(/are\s+(\d+)\s+comparable sales/i);
    if (countMatch) comparableSalesCount = parseNum(countMatch[1]);
    const rangeMatch = csLine.fullText.match(/\$\s*([\d,]+).*?to\s*\$\s*([\d,]+)/i);
    if (rangeMatch) { comparableSalesLow = parseNum(rangeMatch[1]); comparableSalesHigh = parseNum(rangeMatch[2]); }
  }

  // Subject column
  const subBB: Record<string, BoundingBox> = {};
  function getSubject(line: TextLine | undefined): string {
    return line ? segInRange(line, SUBJECT_X.min, SUBJECT_X.max) : "";
  }
  function getSubjectWithBB(line: TextLine | undefined, key: string): string {
    if (!line) return "";
    const r = segWithBBox(line, SUBJECT_X.min, SUBJECT_X.max);
    if (r.seg) subBB[key] = toBBox(r.seg, line);
    return r.text;
  }

  const addrLine = findLine(lines, /^Address/i);
  const subjAddress = getSubjectWithBB(addrLine, "address");
  const projLine = findLine(lines, /^Project Name/i);
  const subjProject = getSubject(projLine);

  const priceLine = findLine(lines, /^Sale Price\b/i);
  const subjPrice = priceLine ? parseCurrency(segInRange(priceLine, SUBJECT_X.min - 20, SUBJECT_X.max)) : null;

  const ppsLine = findLine(lines, /^Sale Price\/Gross Liv/i);
  let subjPPS: number | null = null;
  if (ppsLine) {
    const m = segInRange(ppsLine, SUBJECT_X.min, SUBJECT_X.max).match(/([\d,.]+)/);
    if (m) subjPPS = parseNum(m[1]);
  }

  const hoaLine = findLine(lines, /^HOA Mo\. Assessment/i);
  const subjHOA = hoaLine ? parseNum(getSubject(hoaLine)) : null;

  const rcLine = findLine(lines, /^Room Count/i);
  let subjRCTotal: number | null = null, subjRCBed: number | null = null, subjRCBath: number | null = null;
  if (rcLine) {
    const text = segInRange(rcLine, SUBJECT_X.min, SUBJECT_X.max);
    const parts = text.split(/\s+/).map((s) => parseNum(s)).filter((n) => n !== null);
    if (parts.length >= 3) { subjRCTotal = parts[0]; subjRCBed = parts[1]; subjRCBath = parts[2]; }
  }

  const glaLine = findLine(lines, /^Gross Living Area/i);
  let subjGLA: number | null = null;
  if (glaLine) {
    const m = segInRange(glaLine, SUBJECT_X.min, SUBJECT_X.max).match(/([\d,]+)/);
    if (m) subjGLA = parseNum(m[1]);
  }

  const subject: SalesComparisonSubject = {
    address: subjAddress,
    projectNamePhase: subjProject,
    salePrice: subjPrice,
    salePricePerSqft: subjPPS,
    location: getSubject(findLine(lines, /^Location\b/i)),
    leaseholdFeeSimple: getSubject(findLine(lines, /^Leasehold\/Fee/i)),
    hoaMoAssessment: subjHOA,
    commonElements: getSubject(findLine(lines, /^Common Elements/i)),
    floorLocation: getSubject(findLine(lines, /^Floor Location/i)),
    view: getSubject(findLine(lines, /^View\b/i)),
    designStyle: getSubject(findLine(lines, /^Design \(Style\)/i)),
    qualityOfConstruction: getSubject(findLine(lines, /^Quality of Construction/i)),
    actualAge: parseNum(getSubject(findLine(lines, /^Actual Age/i))),
    condition: getSubjectWithBB(findLine(lines, /^Condition\b/i), "condition"),
    roomCountTotal: subjRCTotal,
    roomCountBedrooms: subjRCBed,
    roomCountBaths: subjRCBath,
    grossLivingArea: subjGLA,
    basementFinished: getSubject(findLine(lines, /^Basement & Finished/i)),
    functionalUtility: getSubject(findLine(lines, /^Functional Utility/i)),
    heatingCooling: getSubject(findLine(lines, /^Heating\/Cooling/i)),
    energyEfficientItems: getSubject(findLine(lines, /^Energy Efficient/i)),
    garageCarport: getSubject(findLine(lines, /^Garage\/Carport/i)),
    porchPatioDeck: getSubject(findLine(lines, /^Porch\/Patio/i)),
    boundingBoxes: subBB,
  };

  // Parse 3 comparables
  const comparables: ComparableSale[] = [];
  for (let i = 0; i < 3; i++) {
    comparables.push(parseComparable(lines, compStartNum + i, COMP_COLS[i]));
  }

  // Summary of Sales Comparison
  const sumLine = findLine(lines, /^Summary of Sales Comparison/i);
  let summaryOfSalesComparison = "";
  if (sumLine) {
    const idx = lines.indexOf(sumLine);
    const parts: string[] = [];
    const valueSeg = sumLine.segments.find((s) => s.x > 150);
    if (valueSeg) parts.push(valueSeg.text.trim());
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^Indicated Value|^INCOME/i.test(lines[i].fullText)) break;
      const t = lines[i].fullText.trim();
      if (t) parts.push(t);
    }
    summaryOfSalesComparison = parts.join(" ").trim();
    if (sumLine.segments[0]) bb.summaryOfSalesComparison = toBBox(sumLine.segments[0], sumLine);
  }

  // Indicated Value by Sales Comparison
  const indLine = findLine(lines, /^Indicated Value by Sales Comparison Approach\s*\$/i);
  let indicatedValueBySalesComparison: number | null = null;
  if (indLine) {
    const seg = indLine.segments.find((s) => s.x > 150 && /^\d/.test(s.text.trim()));
    if (seg) { indicatedValueBySalesComparison = parseNum(seg.text); bb.indicatedBySales = toBBox(seg, indLine); }
  }

  return {
    activeListingsCount, activeListingsLow, activeListingsHigh,
    comparableSalesCount, comparableSalesLow, comparableSalesHigh,
    subject, comparables, summaryOfSalesComparison, indicatedValueBySalesComparison,
    boundingBoxes: bb,
  };
}

// ── Reconciliation ───────────────────────────────────────────────────────

export function parseReconciliationSection(lines: TextLine[]): ReconciliationSection {
  const bb: Record<string, BoundingBox> = {};

  const indAllLine = findLine(lines, /^Indicated Value by: Sales Comparison/i);
  let indicatedValueBySalesComparison: number | null = null, indicatedValueByIncomeApproach: number | null = null;
  if (indAllLine) {
    const salesSeg = indAllLine.segments.find((s) => s.x > 180 && s.x < 260 && /^\d/.test(s.text.trim()));
    if (salesSeg) { indicatedValueBySalesComparison = parseNum(salesSeg.text); bb.indicatedBySales = toBBox(salesSeg, indAllLine); }
    for (const seg of indAllLine.segments) {
      if (/Income Approach.*\$\s*([\d,]+)/i.test(seg.text)) {
        const m = seg.text.match(/\$\s*([\d,]+)/);
        if (m) indicatedValueByIncomeApproach = parseNum(m[1]);
      }
    }
  }

  // Reconciliation comments
  const recLine = findLine(lines, /The Direct Sales Comparison|ALL WEIGHT GIVEN|reconciliation/i);
  let reconciliationComments = "";
  if (recLine) {
    const idx = lines.indexOf(recLine);
    const parts = [recLine.fullText.trim()];
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^This appraisal is made|^RECONCILIATION/i.test(lines[i].fullText)) break;
      const t = lines[i].fullText.trim();
      if (t) parts.push(t);
    }
    reconciliationComments = parts.join(" ").trim();
  }

  // Appraisal basis
  const basisLine = findLine(lines, /This appraisal is made/i);
  let appraisalBasis = "";
  if (basisLine) {
    const idx = lines.indexOf(basisLine);
    const parts = [basisLine.fullText.replace(/^RECONCILIATION/i, "").trim()];
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^Based on a complete|^\$/i.test(lines[i].fullText)) break;
      parts.push(lines[i].fullText.trim());
    }
    appraisalBasis = parts.join(" ").trim();
  }

  // Final value and effective date
  const valueLine = findLine(lines, /^\$\s*[\d,]+\s*,\s*as of/i);
  let finalValue: number | null = null, effectiveDate = "";
  if (valueLine) {
    for (const seg of valueLine.segments) {
      if (/^\d[\d,]*$/.test(seg.text.trim())) {
        finalValue = parseNum(seg.text);
        bb.finalValue = toBBox(seg, valueLine);
      }
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(seg.text.trim())) {
        effectiveDate = seg.text.trim();
        bb.effectiveDate = toBBox(seg, valueLine);
      }
    }
  }

  return { indicatedValueBySalesComparison, indicatedValueByIncomeApproach, reconciliationComments, appraisalBasis, finalValue, effectiveDate, boundingBoxes: bb };
}

// ── Appraiser Info (Page 6) ──────────────────────────────────────────────

export function parseAppraiserInfo(lines: TextLine[], supervisory: boolean): AppraiserInfo | null {
  const bb: Record<string, BoundingBox> = {};
  const xMin = supervisory ? 290 : 0;
  const xMax = supervisory ? 600 : 290;

  function findFieldInRange(label: RegExp): string {
    for (const l of lines) {
      const seg = l.segments.find((s) => s.x >= xMin && s.x < xMax && label.test(s.text));
      if (seg) {
        const val = seg.text.replace(label, "").trim();
        if (val) return val;
        const next = l.segments.find((s) => s.x > seg.x && s.x < xMax && !label.test(s.text));
        if (next) return next.text.trim();
      }
    }
    return "";
  }

  const name = findFieldInRange(/^(Supervisory )?Appraiser\s*$|^Name\s+/i);
  // For supervisory: if name is empty, there is no supervisory appraiser
  if (supervisory && !name) return null;

  const nameLine = lines.find((l) => l.segments.some((s) => s.x >= xMin && s.x < xMax && /^Name\s/i.test(s.text)));
  let parsedName = "";
  if (nameLine) {
    const seg = nameLine.segments.find((s) => s.x >= xMin && s.x < xMax && /^Name\s/i.test(s.text));
    if (seg) { parsedName = seg.text.replace(/^Name\s+/i, "").trim(); bb.name = toBBox(seg, nameLine); }
  }

  return {
    name: parsedName || name,
    companyName: findFieldInRange(/^Company Name\s*/i),
    companyAddress: findFieldInRange(/^Company Address\s*/i),
    telephoneNumber: findFieldInRange(/^Telephone Number\s*/i),
    emailAddress: findFieldInRange(/^Email Address\s*/i),
    dateOfSignature: findFieldInRange(/^Date of Signature( and Report)?\s*/i),
    effectiveDateOfAppraisal: findFieldInRange(/^Effective Date of Appraisal\s*/i),
    stateCertification: findFieldInRange(/^State Certification #\s*/i),
    stateOrLicense: findFieldInRange(/^or State License #\s*/i),
    state: findFieldInRange(/^State\s+(?!Certification|License)/i),
    expirationDate: findFieldInRange(/^Expiration Date of Certification or License\s*/i),
    boundingBoxes: bb,
  };
}

// ── Lender/Client Info (Page 6) ──────────────────────────────────────────

export function parseLenderClientInfo(lines: TextLine[]): LenderClientInfo {
  const bb: Record<string, BoundingBox> = {};

  // Lender info is in the lower-left area of page 6
  const lenderHeader = findLine(lines, /^LENDER\/CLIENT$/i);
  if (!lenderHeader) return { name: "", companyName: "", companyAddress: "", emailAddress: "", boundingBoxes: bb };

  const startY = lenderHeader.y;
  const lenderLines = lines.filter((l) => l.y > startY && l.segments.some((s) => s.x < 290));

  function getField(label: RegExp): string {
    for (const l of lenderLines) {
      for (const seg of l.segments) {
        if (seg.x >= 290) continue;
        if (label.test(seg.text)) {
          const val = seg.text.replace(label, "").trim();
          if (val) return val;
          const next = l.segments.find((s) => s.x > seg.x && s.x < 290 && !label.test(s.text));
          if (next) return next.text.trim();
        }
      }
    }
    return "";
  }

  return {
    name: getField(/^Name\s*/i),
    companyName: getField(/^Company Name\s*/i),
    companyAddress: getField(/^Company Address\s*/i),
    emailAddress: getField(/^Email Address\s*/i),
    boundingBoxes: bb,
  };
}
