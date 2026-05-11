import { toBBox } from "@parseo/shared";
import type { TextLine, BoundingBox } from "@parseo/shared";
import type {
  SalesComparisonSection,
  ComparableSale,
  ReconciliationSection,
  CostApproachSection,
} from "./types.js";

// ── Utilities ─────────────────────────────────────────────────────────────

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

// Column x-boundaries for Form 1004 sales comparison grid
// Subject ~131, Comp1 ~197, Comp2 ~328, Comp3 ~459
// Adjustment columns follow each comp description
const SUBJECT_X = { min: 120, max: 195 };
const COMP_COLS = [
  { desc: { min: 195, max: 295 }, adj: { min: 295, max: 325 } },   // Comp 1
  { desc: { min: 325, max: 430 }, adj: { min: 430, max: 457 } },   // Comp 2
  { desc: { min: 457, max: 560 }, adj: { min: 560, max: 600 } },   // Comp 3
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

// ── Parse comparable from a column ────────────────────────────────────────

function parseComparable(
  lines: TextLine[],
  compNum: number,
  col: typeof COMP_COLS[0]
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

  // City is on the next line after address
  const addrIdx = addrLine ? lines.indexOf(addrLine) : -1;
  const cityLine = addrIdx >= 0 ? lines[addrIdx + 1] : undefined;
  const cityVal = cityLine ? segInRange(cityLine, col.desc.min, col.adj.min) : "";

  const proxLine = findLine(lines, /^Proximity to Subject/i);
  const proximityToSubject = getDescWithBB(proxLine, "proximity");

  const priceLine = findLine(lines, /^Sale Price\b/i);
  let salePrice: number | null = null;
  if (priceLine) {
    // Price segments have $ and number in separate segments
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

  const siteLine = findLine(lines, /^Site\b/i);
  const site = getDesc(siteLine);
  const siteAdjustment = getAdj(siteLine);

  const viewLine = findLine(lines, /^View\b/i);
  const viewVal = getDesc(viewLine);
  const viewAdjustment = getAdj(viewLine);

  const styleLine = findLine(lines, /^Design \(Style\)/i);
  const designStyle = getDesc(styleLine);

  const qualLine = findLine(lines, /^Quality of Construction/i);
  const qualityOfConstruction = getDesc(qualLine);

  const ageLine = findLine(lines, /^Actual Age\b/i);
  const actualAge = parseNum(getDesc(ageLine));
  const ageAdjustment = getAdj(ageLine);

  const condLine = findLine(lines, /^Condition\b/i);
  const condition = getDescWithBB(condLine, "condition");

  // Room count line
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
  const garageCarportAdjustment = getAdj(gcLine);

  const ppLine = findLine(lines, /^Porch\/Patio\/Deck/i);
  const porchPatioDeck = getDesc(ppLine);

  const poolLine = findLine(lines, /^POOL\b/i);
  const poolVal = getDesc(poolLine);
  const poolAdjustment = getAdj(poolLine);

  const olpLine = findLine(lines, /^ORIGINAL LIST PRICE/i);
  const originalListPrice = getDesc(olpLine);

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
    proximityToSubject, salePrice, salePricePerSqft, dataSources, verificationSources,
    salesOrFinancing, concessions, dateOfSaleTime, location, leaseholdFeeSimple,
    site, siteAdjustment, view: viewVal, viewAdjustment, designStyle, qualityOfConstruction,
    actualAge, ageAdjustment, condition,
    roomCountTotal, roomCountBedrooms, roomCountBaths, roomCountAdjustment,
    grossLivingArea, grossLivingAreaAdjustment, basementFinished, functionalUtility,
    heatingCooling, energyEfficientItems, garageCarport, garageCarportAdjustment,
    porchPatioDeck, pool: poolVal, poolAdjustment, originalListPrice,
    netAdjustmentTotal, netAdjustmentPercent, grossAdjustmentPercent, adjustedSalePrice,
    boundingBoxes: bb,
  };
}

// ── Sales Comparison ──────────────────────────────────────────────────────

export function parseSalesComparisonSection(
  lines: TextLine[],
  compStartNum: number = 1
): SalesComparisonSection {
  const bb: Record<string, BoundingBox> = {};

  // Active listings / comparable sales ranges
  const alLine = findLine(lines, /comparable properties currently offered/i);
  let activeListingsLow: number | null = null, activeListingsHigh: number | null = null;
  if (alLine) {
    const m = alLine.fullText.match(/\$\s*([\d,]+).*?to\s*\$\s*([\d,]+)/i);
    if (m) { activeListingsLow = parseNum(m[1]); activeListingsHigh = parseNum(m[2]); }
  }

  const csLine = findLine(lines, /comparable sales in the subject/i);
  let comparableSalesLow: number | null = null, comparableSalesHigh: number | null = null;
  if (csLine) {
    const m = csLine.fullText.match(/\$\s*([\d,]+).*?to\s*\$\s*([\d,]+)/i);
    if (m) { comparableSalesLow = parseNum(m[1]); comparableSalesHigh = parseNum(m[2]); }
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
  const priceLine = findLine(lines, /^Sale Price\b/i);
  const subjPrice = priceLine ? parseCurrency(segInRange(priceLine, SUBJECT_X.min - 20, SUBJECT_X.max)) : null;
  const ppsLine = findLine(lines, /^Sale Price\/Gross Liv/i);
  let subjPPS: number | null = null;
  if (ppsLine) {
    const m = segInRange(ppsLine, SUBJECT_X.min, SUBJECT_X.max).match(/([\d,.]+)/);
    if (m) subjPPS = parseNum(m[1]);
  }

  const subject = {
    address: subjAddress,
    salePrice: subjPrice,
    salePricePerSqft: subjPPS,
    location: getSubject(findLine(lines, /^Location\b/i)),
    leaseholdFeeSimple: getSubject(findLine(lines, /^Leasehold\/Fee/i)),
    site: getSubject(findLine(lines, /^Site\b/i)),
    view: getSubject(findLine(lines, /^View\b/i)),
    designStyle: getSubject(findLine(lines, /^Design \(Style\)/i)),
    qualityOfConstruction: getSubject(findLine(lines, /^Quality of Construction/i)),
    actualAge: parseNum(getSubject(findLine(lines, /^Actual Age/i))),
    condition: getSubjectWithBB(findLine(lines, /^Condition\b/i), "condition"),
    roomCountTotal: null as number | null,
    roomCountBedrooms: null as number | null,
    roomCountBaths: null as number | null,
    grossLivingArea: null as number | null,
    basementFinished: getSubject(findLine(lines, /^Basement & Finished/i)),
    functionalUtility: getSubject(findLine(lines, /^Functional Utility/i)),
    heatingCooling: getSubject(findLine(lines, /^Heating\/Cooling/i)),
    energyEfficientItems: getSubject(findLine(lines, /^Energy Efficient/i)),
    garageCarport: getSubject(findLine(lines, /^Garage\/Carport/i)),
    porchPatioDeck: getSubject(findLine(lines, /^Porch\/Patio/i)),
    pool: getSubject(findLine(lines, /^POOL\b/i)),
    originalListPrice: getSubject(findLine(lines, /^ORIGINAL LIST PRICE/i)),
    boundingBoxes: subBB,
  };

  // Parse room count for subject
  const rcLine = findLine(lines, /^Room Count/i);
  if (rcLine) {
    const text = segInRange(rcLine, SUBJECT_X.min, SUBJECT_X.max);
    const parts = text.split(/\s+/).map((s) => parseNum(s)).filter((n) => n !== null);
    if (parts.length >= 3) { subject.roomCountTotal = parts[0]; subject.roomCountBedrooms = parts[1]; subject.roomCountBaths = parts[2]; }
  }
  const glaLine = findLine(lines, /^Gross Living Area/i);
  if (glaLine) {
    const m = segInRange(glaLine, SUBJECT_X.min, SUBJECT_X.max).match(/([\d,]+)/);
    if (m) subject.grossLivingArea = parseNum(m[1]);
  }

  // Parse 3 comparables
  const comparables: ComparableSale[] = [];
  for (let i = 0; i < 3; i++) {
    comparables.push(parseComparable(lines, compStartNum + i, COMP_COLS[i]));
  }

  // Prior sale analysis
  const priorLine = findLine(lines, /Analysis of prior sale or transfer/i);
  let priorSaleAnalysis = "";
  if (priorLine) {
    const idx = lines.indexOf(priorLine);
    const parts: string[] = [];
    const valueSeg = priorLine.segments.find((s) => s.x > 280);
    if (valueSeg) parts.push(valueSeg.text.trim());
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^Summary of Sales|^Analysis\/Comments|^Indicated Value/i.test(lines[i].fullText)) break;
      const t = lines[i].fullText.trim();
      if (t && !/^AFFECT FINAL/.test(t) || /AFFECT FINAL/.test(t)) parts.push(t);
    }
    priorSaleAnalysis = parts.join(" ").trim();
  }

  // Summary
  const sumLine = findLine(lines, /^Summary of Sales Comparison|^Analysis\/Comments/i);
  let summaryOfSalesComparison = "";
  if (sumLine) {
    const idx = lines.indexOf(sumLine);
    const parts: string[] = [];
    const valueSeg = sumLine.segments.find((s) => s.x > 150);
    if (valueSeg) parts.push(valueSeg.text.trim());
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^Indicated Value|^AS-IS APPRAISED/i.test(lines[i].fullText)) break;
      const t = lines[i].fullText.trim();
      if (t) parts.push(t);
    }
    summaryOfSalesComparison = parts.join(" ").trim();
    if (sumLine.segments[0]) bb.summaryOfSalesComparison = toBBox(sumLine.segments[0], sumLine);
  }

  return {
    activeListingsLow, activeListingsHigh, comparableSalesLow, comparableSalesHigh,
    subject, comparables, priorSaleAnalysis, summaryOfSalesComparison,
    boundingBoxes: bb,
  };
}

// ── Reconciliation ────────────────────────────────────────────────────────

export function parseReconciliationSection(lines: TextLine[]): ReconciliationSection {
  const bb: Record<string, BoundingBox> = {};

  const indLine = findLine(lines, /^Indicated Value by Sales Comparison Approach\s*\$/i);
  let indicatedValueBySalesComparison: number | null = null;
  if (indLine) {
    const seg = indLine.segments.find((s) => s.x > 150 && /^\d/.test(s.text.trim()));
    if (seg) { indicatedValueBySalesComparison = parseNum(seg.text); bb.indicatedBySales = toBBox(seg, indLine); }
  }

  const indAllLine = findLine(lines, /^Indicated Value by: Sales Comparison/i);
  let indicatedValueByCostApproach: number | null = null, indicatedValueByIncomeApproach: number | null = null;
  if (indAllLine) {
    for (const seg of indAllLine.segments) {
      if (/Cost Approach.*\$\s*([\d,]+)/i.test(seg.text)) {
        const m = seg.text.match(/\$\s*([\d,]+)/);
        if (m) { indicatedValueByCostApproach = parseNum(m[1]); bb.indicatedByCost = toBBox(seg, indAllLine); }
      }
      if (/Income Approach.*\$\s*([\d,]+)/i.test(seg.text)) {
        const m = seg.text.match(/\$\s*([\d,]+)/);
        if (m) indicatedValueByIncomeApproach = parseNum(m[1]);
      }
    }
    // Also get sales comparison from this line
    if (!indicatedValueBySalesComparison) {
      const salesSeg = indAllLine.segments.find((s) => s.x > 180 && s.x < 255 && /^\d/.test(s.text.trim()));
      if (salesSeg) indicatedValueBySalesComparison = parseNum(salesSeg.text);
    }
  }

  // Reconciliation comments
  const recLine = findLine(lines, /ALL WEIGHT GIVEN|reconciliation|weight.*given/i);
  let reconciliationComments = "";
  if (recLine) {
    const idx = lines.indexOf(recLine);
    const parts = [recLine.fullText.trim()];
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^This appraisal is made|^Based on a complete/i.test(lines[i].fullText)) break;
      const t = lines[i].fullText.trim();
      if (t) parts.push(t);
    }
    reconciliationComments = parts.join(" ").trim();
    bb.reconciliationComments = toBBox(recLine.segments[0], recLine);
  }

  // Appraisal basis
  const basisLine = findLine(lines, /This appraisal is made/i);
  let appraisalBasis = "";
  if (basisLine) {
    const idx = lines.indexOf(basisLine);
    const parts = [basisLine.fullText.trim()];
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

  return { indicatedValueBySalesComparison, indicatedValueByCostApproach, indicatedValueByIncomeApproach, reconciliationComments, appraisalBasis, finalValue, effectiveDate, boundingBoxes: bb };
}

// ── Cost Approach (Page 3) ────────────────────────────────────────────────

export function parseCostApproachSection(lines: TextLine[]): CostApproachSection {
  const bb: Record<string, BoundingBox> = {};

  function findCostVal(pattern: RegExp): number | null {
    for (const l of lines) {
      if (!pattern.test(l.fullText)) continue;
      // Dollar value is usually at the far right (x > 500)
      const valSeg = l.segments.filter((s) => s.x > 480);
      for (const seg of valSeg) {
        const n = parseNum(seg.text);
        if (n !== null) return n;
      }
    }
    return null;
  }

  const siteValueLine = findLine(lines, /support for the opinion of site value/i);
  let siteValueSupport = "";
  if (siteValueLine) {
    const valueSeg = siteValueLine.segments.find((s) => s.x > 250);
    if (valueSeg) siteValueSupport = valueSeg.text.trim();
    // Continue on next lines
    const idx = lines.indexOf(siteValueLine);
    const parts = siteValueSupport ? [siteValueSupport] : [];
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^ESTIMATED|^OPINION OF SITE/i.test(lines[i].fullText)) break;
      parts.push(lines[i].fullText.trim());
    }
    siteValueSupport = parts.join(" ").trim();
  }

  const siteValue = findCostVal(/OPINION OF SITE VALUE/i);

  // Dwelling cost
  const dwellingLine = findLine(lines, /^DWELLING/i);
  let dwellingSqft: number | null = null, dwellingCostPerSqft: number | null = null, dwellingCost: number | null = null;
  if (dwellingLine) {
    const sqftMatch = dwellingLine.fullText.match(/([\d,]+)\s*Sq\.?\s*Ft/i);
    if (sqftMatch) dwellingSqft = parseNum(sqftMatch[1]);
    const costMatch = dwellingLine.fullText.match(/@\s*\$?\s*([\d,.]+)/i) || dwellingLine.fullText.match(/(\d+\.?\d*)\s*=\s*\$/);
    if (costMatch) dwellingCostPerSqft = parseNum(costMatch[1]);
    const valSegs = dwellingLine.segments.filter((s) => s.x > 480);
    for (const seg of valSegs) {
      const n = parseNum(seg.text);
      if (n !== null) { dwellingCost = n; bb.dwellingCost = toBBox(seg, dwellingLine); }
    }
  }

  const amenitiesCost = findCostVal(/AMENITIES/i);

  // Garage/Carport
  const garageLine = findLine(lines, /^Garage\/Carport/i);
  let garageCarportSqft: number | null = null, garageCarportCostPerSqft: number | null = null, garageCarportCost: number | null = null;
  if (garageLine) {
    const sqftMatch = garageLine.fullText.match(/([\d,]+)\s*Sq\.?\s*Ft/i);
    if (sqftMatch) garageCarportSqft = parseNum(sqftMatch[1]);
    const costMatch = garageLine.fullText.match(/@\s*\$?\s*([\d,.]+)/i) || garageLine.fullText.match(/(\d+\.?\d*)\s*=\s*\$/);
    if (costMatch) garageCarportCostPerSqft = parseNum(costMatch[1]);
    const valSegs = garageLine.segments.filter((s) => s.x > 480);
    for (const seg of valSegs) {
      const n = parseNum(seg.text);
      if (n !== null) garageCarportCost = n;
    }
  }

  const totalCostNew = findCostVal(/Total Estimate of Cost-?New/i);
  const depreciation = findCostVal(/^Depreciation\b/i);
  const depreciatedCostOfImprovements = findCostVal(/Depreciated Cost of Improvements/i);
  const asIsValueOfSiteImprovements = findCostVal(/As-?is.*Value of Site Improvements/i);
  const indicatedValueByCostApproach = findCostVal(/INDICATED VALUE BY COST APPROACH/i);

  const erlLine = findLine(lines, /Estimated Remaining Economic Life/i);
  let estimatedRemainingEconomicLife: number | null = null;
  if (erlLine) {
    const m = erlLine.fullText.match(/(\d+)\s*Years/i);
    if (m) estimatedRemainingEconomicLife = parseNum(m[1]);
  }

  return {
    siteValueSupport, siteValue, dwellingSqft, dwellingCostPerSqft, dwellingCost,
    amenitiesCost, garageCarportSqft, garageCarportCostPerSqft, garageCarportCost,
    totalCostNew, depreciation, depreciatedCostOfImprovements, asIsValueOfSiteImprovements,
    indicatedValueByCostApproach, estimatedRemainingEconomicLife, boundingBoxes: bb,
  };
}
