import { extractLines, UnrecognizedFormatError, toBBox } from "@parseo/shared";
import type { TextLine, TextSegment, BoundingBox } from "@parseo/shared";
import type {
  Form1004MCReport,
  Form1004MCHeader,
  MarketConditionsAddendum,
  InventoryAnalysis,
  MedianSaleListData,
  MarketAnalysisText,
  CondoCoopProjects,
  AppraiserInfo,
  TimePeriodRow,
} from "./types.js";
import { parseSubjectSection, parseContractSection, parseNeighborhoodSection, parseSiteSection, parseImprovementsSection } from "./parse-page1.js";
import { parseSalesComparisonSection, parseReconciliationSection, parseCostApproachSection } from "./parse-sales.js";
import { extractCheckedBoxes, resolveCheckbox } from "./extract-checkboxes.js";

export async function parseForm1004MC(buffer: Buffer): Promise<Form1004MCReport> {
  const lines = await extractLines(buffer);
  return parseForm1004MCFromLines(lines, buffer);
}

export async function parseForm1004MCFromLines(
  lines: TextLine[],
  buffer: Buffer,
  pageOffset: number = 0,
): Promise<Form1004MCReport> {
  // Find the URAR start page — it may not be page 1 (intro/addendum pages may precede it)
  let urarPage = -1;
  for (const l of lines) {
    if (/Uniform Residential Appraisal Report|Form 1004/i.test(l.fullText)) {
      urarPage = l.page;
      break;
    }
  }
  if (urarPage < 0) {
    throw new UnrecognizedFormatError(
      "Form1004MC",
      "no page contains a Form 1004 / URAR signature"
    );
  }

  // If the URAR doesn't start on page 1, remap page numbers so section
  // parsers can use page===1, page===2, etc. consistently, and record
  // the offset so checkbox extraction targets the correct physical page.
  if (urarPage > 1) {
    pageOffset += urarPage - 1;
    lines = lines
      .filter((l) => l.page >= urarPage)
      .map((l) => ({ ...l, page: l.page - urarPage + 1 }));
  }

  // ── Page 1: Subject, Contract, Neighborhood, Site, Improvements ──
  const page1 = lines.filter((l) => l.page === 1);
  const subject = parseSubjectSection(page1);
  const contract = parseContractSection(page1);
  const neighborhood = parseNeighborhoodSection(page1);
  const site = parseSiteSection(page1);
  const improvements = parseImprovementsSection(page1);

  // ── Page 2: Sales Comparison (comps 1-3), Reconciliation ──
  const page2 = lines.filter((l) => l.page === 2);
  const salesComparison = parseSalesComparisonSection(page2, 1);
  const reconciliation = parseReconciliationSection(page2);

  // ── Resolve checkbox fields via vector-graphic detection ──
  // In flattened PDFs, all checkbox labels are static text. The checked
  // state is a small X drawn with constructPath ops. We count path shapes
  // at each checkbox position: ≥3 shapes = checked, 1 shape = unchecked.
  // pageOffset adjusts for skipped intro pages so we hit the real page 1 in the buffer.
  const checked = await extractCheckedBoxes(buffer, 1 + pageOffset);

  // Helper: resolve a checkbox and add its bounding box
  function resolveAndBBox(
    line: TextLine | undefined,
    field: string,
    options: { x: number; label: string }[],
    targetBB: Record<string, BoundingBox> = neighborhood.boundingBoxes,
  ): string {
    if (!line) return "";
    const value = resolveCheckbox(checked, line.y, options);
    if (value) {
      const seg = line.segments.find((s) => s.text.trim() === value);
      if (seg) targetBB[field] = toBBox(seg, line);
    }
    return value;
  }

  const locLine = page1.find((l) => /^Location\b/.test(l.fullText));
  const builtLine = page1.find((l) => /^Built-Up\b/.test(l.fullText));
  const growthLine2 = page1.find((l) => /^Growth\b/.test(l.fullText));

  neighborhood.location = resolveAndBBox(locLine, "location", [
    { x: 75.0, label: "Urban" },
    { x: 122.5, label: "Suburban" },
    { x: 172.0, label: "Rural" },
  ]);
  neighborhood.propertyValues = resolveAndBBox(locLine, "propertyValues", [
    { x: 276.5, label: "Increasing" },
    { x: 334.4, label: "Stable" },
    { x: 383.8, label: "Declining" },
  ]);
  neighborhood.builtUp = resolveAndBBox(builtLine, "builtUp", [
    { x: 75.0, label: "Over 75%" },
    { x: 122.5, label: "25-75%" },
    { x: 172.0, label: "Under 25%" },
  ]);
  neighborhood.demandSupply = resolveAndBBox(builtLine, "demandSupply", [
    { x: 276.5, label: "Shortage" },
    { x: 334.4, label: "In Balance" },
    { x: 383.8, label: "Over Supply" },
  ]);
  neighborhood.growth = resolveAndBBox(growthLine2, "growth", [
    { x: 75.0, label: "Rapid" },
    { x: 122.5, label: "Stable" },
    { x: 172.0, label: "Slow" },
  ]);
  neighborhood.marketingTime = resolveAndBBox(growthLine2, "marketingTime", [
    { x: 276.5, label: "Under 3 mths" },
    { x: 334.4, label: "3-6 mths" },
    { x: 383.8, label: "Over 6 mths" },
  ]);

  // ── Subject checkbox fields ──
  const occLine = page1.find((l) => /^Occupant/i.test(l.fullText));
  subject.occupant = resolveAndBBox(occLine, "occupant", [
    { x: 77.9, label: "Owner" },
    { x: 116.9, label: "Tenant" },
    { x: 157.7, label: "Vacant" },
  ], subject.boundingBoxes);

  // ── Page 3: Cost Approach ──
  const page3 = lines.filter((l) => l.page === 3);
  const costApproach = parseCostApproachSection(page3);

  // ── Page 7 (or addendum page): Additional comparables (comps 4-6) ──
  // Find the addendum page with additional comps by looking for "COMPARABLE SALE # 4" or similar
  const addendumPage = findAdditionalCompsPage(lines);
  if (addendumPage >= 0) {
    const addendumLines = lines.filter((l) => l.page === addendumPage);
    const additionalComps = parseSalesComparisonSection(addendumLines, 4);
    // Merge additional comparables into the main sales comparison
    salesComparison.comparables.push(...additionalComps.comparables);
    if (additionalComps.summaryOfSalesComparison) {
      salesComparison.summaryOfSalesComparison += " " + additionalComps.summaryOfSalesComparison;
    }
  }

  // ── 1004MC Market Conditions Addendum page ──
  const mcPage = findMCPage(lines);
  let marketConditionsAddendum: MarketConditionsAddendum;
  if (mcPage >= 0) {
    const mcLines = lines.filter((l) => l.page === mcPage);
    marketConditionsAddendum = parseMCAddendum(mcLines);
  } else {
    // No 1004MC page found — create empty addendum
    marketConditionsAddendum = emptyMCAddendum();
  }

  return {
    subject,
    contract,
    neighborhood,
    site,
    improvements,
    salesComparison,
    reconciliation,
    costApproach,
    marketConditionsAddendum,
  };
}

// ── Page detection helpers ────────────────────────────────────────────────

function findMCPage(lines: TextLine[]): number {
  for (const line of lines) {
    if (/Market Conditions Addendum/i.test(line.fullText)) return line.page;
  }
  return -1;
}

function findAdditionalCompsPage(lines: TextLine[]): number {
  for (const line of lines) {
    if (line.page <= 2) continue; // Skip the main comp page
    if (/COMPARABLE SALE #\s*[4-9]/i.test(line.fullText)) return line.page;
  }
  return -1;
}

function emptyMCAddendum(): MarketConditionsAddendum {
  const emptyRow = (): TimePeriodRow => ({ prior7to12Months: null, prior4to6Months: null, current3Months: null, overallTrend: null, boundingBoxes: {} });
  return {
    header: { propertyAddress: "", city: "", state: "", zipCode: "", borrower: "", fileNumber: "", boundingBoxes: {} },
    inventoryAnalysis: { totalComparableSales: emptyRow(), absorptionRate: emptyRow(), totalActiveListings: emptyRow(), monthsOfSupply: emptyRow(), boundingBoxes: {} },
    medianSaleListData: { medianSalePrice: emptyRow(), medianSalesDaysOnMarket: emptyRow(), medianListPrice: emptyRow(), medianListingsDaysOnMarket: emptyRow(), medianSalePriceAsPercentOfList: emptyRow(), sellerPaidFinancialAssistance: null, sellerPaidFinancialAssistanceTrend: null, boundingBoxes: {} },
    marketAnalysisText: { sellerConcessionsExplanation: "", foreclosureSalesInMarket: null, foreclosureExplanation: "", dataSources: "", summary: "", boundingBoxes: {} },
    condoCoopProjects: null,
    appraiser: { name: "", companyName: "", companyAddress: "", stateLicenseCertification: "", state: "", email: "", boundingBoxes: {} },
    supervisoryAppraiser: null,
  };
}

// ── 1004MC Addendum parsing (existing logic, now returns MarketConditionsAddendum) ──

function parseMCAddendum(pageLines: TextLine[]): MarketConditionsAddendum {
  const header = parseMCHeader(pageLines);
  const inventoryAnalysis = parseInventoryAnalysis(pageLines);
  const medianSaleListData = parseMedianSaleListData(pageLines);
  const marketAnalysisText = parseMarketAnalysisText(pageLines);
  const condoCoopProjects = parseCondoCoopProjects(pageLines);
  const appraiser = parseMCAppraiserInfo(pageLines, false)!;
  const supervisoryAppraiser = parseMCAppraiserInfo(pageLines, true);

  return { header, inventoryAnalysis, medianSaleListData, marketAnalysisText, condoCoopProjects, appraiser, supervisoryAppraiser };
}

// ── MC Header ─────────────────────────────────────────────────────────────

function parseMCHeader(lines: TextLine[]): Form1004MCHeader {
  const bb: Record<string, BoundingBox> = {};

  const addrLine = lines.find((l) => /^Property Address/i.test(l.fullText));
  let propertyAddress = "", city = "", state = "", zipCode = "";
  if (addrLine) {
    for (const seg of addrLine.segments) {
      const text = seg.text.trim();
      if (/^Property Address\s+/i.test(text)) { propertyAddress = text.replace(/^Property Address\s+/i, "").trim(); bb.propertyAddress = toBBox(seg, addrLine); }
      else if (/^City\s+/i.test(text)) { city = text.replace(/^City\s+/i, "").trim(); bb.city = toBBox(seg, addrLine); }
      else if (/^State\s+/i.test(text)) { state = text.replace(/^State\s+/i, "").trim(); bb.state = toBBox(seg, addrLine); }
      else if (/^ZIP Code\s+/i.test(text)) { zipCode = text.replace(/^ZIP Code\s+/i, "").trim(); bb.zipCode = toBBox(seg, addrLine); }
    }
  }

  const borrowerLine = lines.find((l) => /^Borrower\s/i.test(l.fullText));
  let borrower = "";
  if (borrowerLine) {
    borrower = borrowerLine.fullText.replace(/^Borrower\s+/i, "").trim();
    if (borrowerLine.segments.length > 0) bb.borrower = toBBox(borrowerLine.segments[0], borrowerLine);
  }

  let fileNumber = "";
  for (const line of lines) {
    const fileSeg = line.segments.find((s) => /^File No\.\s/i.test(s.text.trim()) && !/Main File/i.test(s.text));
    if (fileSeg) { fileNumber = fileSeg.text.replace(/^File No\.\s*/i, "").trim(); bb.fileNumber = toBBox(fileSeg, line); break; }
  }

  return { propertyAddress, city, state, zipCode, borrower, fileNumber, boundingBoxes: bb };
}

// ── Grid parsing utilities ────────────────────────────────────────────────

const COL_PRIOR_7_12 = { min: 195, max: 270 };
const COL_PRIOR_4_6 = { min: 270, max: 350 };
const COL_CURRENT_3 = { min: 350, max: 435 };

function parseNum(raw: string): number | null {
  if (!raw || /^n\/?a$/i.test(raw.trim())) return null;
  const cleaned = raw.replace(/[$,%]/g, "").replace(/,/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
}

function getValueInRange(segments: TextSegment[], min: number, max: number): TextSegment | null {
  return segments.find((s) => s.x >= min && s.x < max && !/^(Increasing|Stable|Declining)$/i.test(s.text.trim())) ?? null;
}

function parseTimePeriodRow(line: TextLine | undefined, bb: Record<string, BoundingBox>, prefix: string): TimePeriodRow {
  const row: TimePeriodRow = { prior7to12Months: null, prior4to6Months: null, current3Months: null, overallTrend: null, boundingBoxes: {} };
  if (!line) return row;

  const segs = line.segments;
  const seg712 = getValueInRange(segs, COL_PRIOR_7_12.min, COL_PRIOR_7_12.max);
  if (seg712) { row.prior7to12Months = parseNum(seg712.text); row.boundingBoxes[`${prefix}_prior7to12`] = toBBox(seg712, line); bb[`${prefix}_prior7to12`] = toBBox(seg712, line); }
  const seg46 = getValueInRange(segs, COL_PRIOR_4_6.min, COL_PRIOR_4_6.max);
  if (seg46) { row.prior4to6Months = parseNum(seg46.text); row.boundingBoxes[`${prefix}_prior4to6`] = toBBox(seg46, line); bb[`${prefix}_prior4to6`] = toBBox(seg46, line); }
  const segCur = getValueInRange(segs, COL_CURRENT_3.min, COL_CURRENT_3.max);
  if (segCur) { row.current3Months = parseNum(segCur.text); row.boundingBoxes[`${prefix}_current3`] = toBBox(segCur, line); bb[`${prefix}_current3`] = toBBox(segCur, line); }

  return row;
}

function findRowByLabel(lines: TextLine[], pattern: RegExp): TextLine | undefined {
  return lines.find((l) => pattern.test(l.fullText) && !(/Prior \d/.test(l.fullText) && /Overall Trend/i.test(l.fullText)));
}

function parseInventoryAnalysis(lines: TextLine[]): InventoryAnalysis {
  const bb: Record<string, BoundingBox> = {};
  const startIdx = lines.findIndex((l) => /^Inventory Analysis/i.test(l.fullText));
  const endIdx = lines.findIndex((l) => /^Median Sale & List Price/i.test(l.fullText));
  const section = startIdx >= 0 && endIdx > startIdx ? lines.slice(startIdx, endIdx) : lines;

  return {
    totalComparableSales: parseTimePeriodRow(findRowByLabel(section, /Total # of Comparable Sales/i), bb, "invSales"),
    absorptionRate: parseTimePeriodRow(findRowByLabel(section, /Absorption Rate/i), bb, "invAbsorption"),
    totalActiveListings: parseTimePeriodRow(findRowByLabel(section, /Total # of Comparable Active Listings/i), bb, "invListings"),
    monthsOfSupply: parseTimePeriodRow(findRowByLabel(section, /Months of Housing Supply/i), bb, "invSupply"),
    boundingBoxes: bb,
  };
}

function parseMedianSaleListData(lines: TextLine[]): MedianSaleListData {
  const bb: Record<string, BoundingBox> = {};
  const startIdx = lines.findIndex((l) => /^Median Sale & List Price/i.test(l.fullText));
  const endIdx = lines.findIndex((l) => /Explain in detail the seller concessions/i.test(l.fullText));
  const section = startIdx >= 0 && endIdx > startIdx ? lines.slice(startIdx, endIdx) : lines;

  return {
    medianSalePrice: parseTimePeriodRow(findRowByLabel(section, /^Median Comparable Sale Price\b/i), bb, "medSalePrice"),
    medianSalesDaysOnMarket: parseTimePeriodRow(findRowByLabel(section, /Median Comparable Sales Days on Market/i), bb, "medDOM"),
    medianListPrice: parseTimePeriodRow(findRowByLabel(section, /^Median Comparable List Price\b/i), bb, "medListPrice"),
    medianListingsDaysOnMarket: parseTimePeriodRow(findRowByLabel(section, /Median Comparable Listings Days on Market/i), bb, "medListDOM"),
    medianSalePriceAsPercentOfList: parseTimePeriodRow(findRowByLabel(section, /Median Sale Price as % of List/i), bb, "medPctList"),
    sellerPaidFinancialAssistance: null,
    sellerPaidFinancialAssistanceTrend: null,
    boundingBoxes: bb,
  };
}

function collectTextBetween(lines: TextLine[], startPattern: RegExp, endPattern: RegExp): { text: string; startLine: TextLine | null } {
  let collecting = false;
  const parts: string[] = [];
  let startLine: TextLine | null = null;
  for (const line of lines) {
    if (!collecting && startPattern.test(line.fullText)) {
      collecting = true; startLine = line;
      const match = line.fullText.match(startPattern);
      if (match && match.index !== undefined) { const after = line.fullText.slice(match.index + match[0].length).trim(); if (after) parts.push(after); }
      else parts.push(line.fullText.trim());
      continue;
    }
    if (collecting) { if (endPattern.test(line.fullText)) break; parts.push(line.fullText.trim()); }
  }
  return { text: parts.join(" ").trim(), startLine };
}

function parseMarketAnalysisText(lines: TextLine[]): MarketAnalysisText {
  const bb: Record<string, BoundingBox> = {};

  const cr = collectTextBetween(lines, /Explain in detail the seller concessions/i, /^(N\/A|Are foreclosure sales)/i);
  let sellerConcessionsExplanation = cr.text.replace(/^.*?etc\.\)\.\s*/is, "").trim();
  if (cr.startLine?.segments[0]) bb.sellerConcessions = toBBox(cr.startLine.segments[0], cr.startLine);

  const foreclosureLine = lines.find((l) => /Are foreclosure sales.*factor in the market/i.test(l.fullText));
  let foreclosureSalesInMarket: boolean | null = null;
  if (foreclosureLine) {
    if (/\bNo\b/.test(foreclosureLine.fullText)) foreclosureSalesInMarket = false;
    if (/\bYes\b/.test(foreclosureLine.fullText) && !/\bNo\b/.test(foreclosureLine.fullText)) foreclosureSalesInMarket = true;
    bb.foreclosureSales = toBBox(foreclosureLine.segments[0], foreclosureLine);
  }

  let foreclosureExplanation = "";
  const fIdx = lines.findIndex((l) => /Are foreclosure sales.*factor in the market/i.test(l.fullText));
  if (fIdx >= 0) { const parts: string[] = []; for (let i = fIdx + 1; i < lines.length; i++) { if (/^Cite data sources/i.test(lines[i].fullText)) break; const t = lines[i].fullText.trim(); if (t) parts.push(t); } foreclosureExplanation = parts.join(" ").trim(); }

  const dr = collectTextBetween(lines, /Cite data sources for above/i, /Summarize the above information/i);
  const dataSources = dr.text.replace(/^.*?information\.\s*/is, "").trim();

  const sr = collectTextBetween(lines, /Summarize the above information/i, /If the subject is a unit in a condominium/i);
  const summary = sr.text.replace(/^.*?support for your conclusions\.\s*/is, "").trim();

  return { sellerConcessionsExplanation, foreclosureSalesInMarket, foreclosureExplanation, dataSources, summary, boundingBoxes: bb };
}

function parseCondoCoopProjects(lines: TextLine[]): CondoCoopProjects | null {
  const bb: Record<string, BoundingBox> = {};
  const startIdx = lines.findIndex((l) => /If the subject is a unit in a condominium/i.test(l.fullText));
  if (startIdx < 0) return null;
  const section = lines.slice(startIdx);

  const projLine = section.find((l) => /Project Name/i.test(l.fullText));
  let projectName = "";
  if (projLine) { const seg = projLine.segments.find((s) => /Project Name/i.test(s.text)); if (seg) projectName = seg.text.replace(/^Project Name:?\s*/i, "").trim(); }

  const gridStart = section.findIndex((l) => /^Subject Project Data/i.test(l.fullText));
  const grid = gridStart >= 0 ? section.slice(gridStart) : section;

  const emptyRow = (): TimePeriodRow => ({ prior7to12Months: null, prior4to6Months: null, current3Months: null, overallTrend: null, boundingBoxes: {} });
  const salesData = parseTimePeriodRow(findRowByLabel(grid, /Total # of Comparable Sales/i), bb, "condoSales");
  const absData = parseTimePeriodRow(findRowByLabel(grid, /Absorption Rate/i), bb, "condoAbsorption");
  const listingsData = parseTimePeriodRow(findRowByLabel(grid, /Total # of Active Comparable Listings/i), bb, "condoListings");
  const supplyData = parseTimePeriodRow(findRowByLabel(grid, /Months of Unit Supply/i), bb, "condoSupply");

  if (salesData.prior7to12Months === null && salesData.current3Months === null && !projectName) return null;

  return { projectName, totalComparableSales: salesData, absorptionRate: absData, totalActiveListings: listingsData, monthsOfUnitSupply: supplyData, foreclosureSalesInProject: null, foreclosureExplanation: "", summary: "", boundingBoxes: bb };
}

function parseMCAppraiserInfo(lines: TextLine[], supervisory: boolean): AppraiserInfo | null {
  const bb: Record<string, BoundingBox> = {};
  const prefix = supervisory ? "sup" : "app";
  const xThreshold = supervisory ? 300 : 0;
  const xMax = supervisory ? 600 : 300;

  let nameLine: TextLine | undefined;
  for (const l of lines) {
    const hasLabel = l.segments.some((s) => s.x >= xThreshold && s.x < xMax && (supervisory ? /Supervisory Appraiser Name/i.test(s.text) : /^Appraiser Name/i.test(s.text.trim())));
    if (hasLabel) { nameLine = l; break; }
  }

  let name = "";
  if (nameLine) {
    const seg = nameLine.segments.find((s) => s.x >= xThreshold && s.x < xMax && !/Appraiser Name|Supervisory/i.test(s.text));
    if (seg) { name = seg.text.trim(); bb[`${prefix}Name`] = toBBox(seg, nameLine); }
    else { const labelSeg = nameLine.segments.find((s) => s.x >= xThreshold && s.x < xMax && (supervisory ? /Supervisory Appraiser Name/i.test(s.text) : /Appraiser Name/i.test(s.text))); if (labelSeg) { name = labelSeg.text.replace(/^(Supervisory )?Appraiser Name\s*/i, "").trim(); bb[`${prefix}Name`] = toBBox(labelSeg, nameLine); } }
  }
  if (supervisory && !name) return null;

  function findFieldLine(label: RegExp): TextLine | undefined {
    return lines.find((l) => l.segments.some((s) => s.x >= xThreshold && s.x < xMax && label.test(s.text)));
  }
  function getField(label: RegExp): string {
    const line = findFieldLine(label);
    if (!line) return "";
    const seg = line.segments.find((s) => s.x >= xThreshold && s.x < xMax && label.test(s.text));
    return seg ? seg.text.replace(label, "").trim() : "";
  }

  const companyName = getField(/^Company Name\s*/i);
  const addrLine = findFieldLine(/^Company Address/i);
  let companyAddress = "";
  if (addrLine) {
    const segs = addrLine.segments.filter((s) => s.x >= xThreshold && s.x < xMax && !/Company Address/i.test(s.text));
    companyAddress = segs.length > 0 ? segs.map((s) => s.text.trim()).join(" ") : getField(/^Company Address\s*/i);
  }

  const licLine = findFieldLine(/^State License\/Certification/i);
  let stateLicenseCertification = "", stateVal = "";
  if (licLine) {
    const licSeg = licLine.segments.find((s) => s.x >= xThreshold && s.x < xMax && /State License\/Certification/i.test(s.text));
    if (licSeg) stateLicenseCertification = licSeg.text.replace(/^State License\/Certification #\s*/i, "").trim();
    const stateSeg = licLine.segments.find((s) => s.x >= xThreshold && s.x < xMax && /^State\s+/i.test(s.text) && !/License/i.test(s.text));
    if (stateSeg) stateVal = stateSeg.text.replace(/^State\s+/i, "").trim();
  }

  const email = getField(/^Email Address\s*/i);

  return { name, companyName, companyAddress, stateLicenseCertification, state: stateVal, email, boundingBoxes: bb };
}
