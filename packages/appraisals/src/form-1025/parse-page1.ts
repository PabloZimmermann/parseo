import { toBBox } from "@parseo/shared";
import type { TextLine, BoundingBox } from "@parseo/shared";
import { resolveCheckbox } from "../form-1004mc/extract-checkboxes.js";
import type { CheckedPosition } from "../form-1004mc/extract-checkboxes.js";
import type {
  SubjectSection,
  ContractSection,
  NeighborhoodSection,
  SiteSection,
  ImprovementsSection,
  ImprovementUnit,
} from "./types.js";

// ── Utilities ────────────────────────────────────────────────────────────

function parseNum(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,%]/g, "").replace(/,/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
}

function extractAfterLabel(seg: { text: string }, label: RegExp): string {
  return seg.text.replace(label, "").trim();
}

function findLine(lines: TextLine[], pattern: RegExp): TextLine | undefined {
  return lines.find((l) => pattern.test(l.fullText));
}

/** Value segment immediately following the segment that matches `label`. */
function labelNextValue(line: TextLine | undefined, label: RegExp): string {
  if (!line) return "";
  const idx = line.segments.findIndex((s) => label.test(s.text));
  if (idx < 0) return "";
  const same = line.segments[idx];
  const after = same.text.replace(label, "").trim();
  if (after) return after;
  const next = line.segments[idx + 1];
  return next ? next.text.trim() : "";
}

// ── Subject ──────────────────────────────────────────────────────────────

export function parseSubjectSection(lines: TextLine[], checked: CheckedPosition[]): SubjectSection {
  const bb: Record<string, BoundingBox> = {};

  const addrLine = findLine(lines, /^Property Address/i);
  let propertyAddress = "", city = "", state = "", zipCode = "";
  if (addrLine) {
    propertyAddress = labelNextValue(addrLine, /^Property Address\s*/i);
    city = labelNextValue(addrLine, /^City\s*/i);
    const stateSeg = addrLine.segments.find((s) => /^State\s/i.test(s.text));
    if (stateSeg) {
      const m = stateSeg.text.match(/^State\s+(\S+)\s+Zip Code\s+(\S+)/i);
      if (m) { state = m[1]; zipCode = m[2]; }
      else state = extractAfterLabel(stateSeg, /^State\s+/i);
      bb.state = toBBox(stateSeg, addrLine);
    }
    if (addrLine.segments[1]) bb.propertyAddress = toBBox(addrLine.segments[1], addrLine);
  }

  const borrowerLine = findLine(lines, /^Borrower\s/i);
  let borrower = "", ownerOfPublicRecord = "", county = "";
  if (borrowerLine) {
    borrower = labelNextValue(borrowerLine, /^Borrower\s*/i);
    ownerOfPublicRecord = labelNextValue(borrowerLine, /^Owner of Public Record\s*/i);
    county = labelNextValue(borrowerLine, /^County\s*/i);
  }

  const legalLine = findLine(lines, /^Legal Description\s/i);
  const legalDescription = legalLine ? labelNextValue(legalLine, /^Legal Description\s*/i) : "";
  if (legalLine?.segments[1]) bb.legalDescription = toBBox(legalLine.segments[1], legalLine);

  const apnLine = findLine(lines, /^Assessor's Parcel #/i);
  let assessorParcelNumber = "", taxYear: number | null = null, realEstateTaxes: number | null = null;
  if (apnLine) {
    assessorParcelNumber = labelNextValue(apnLine, /^Assessor's Parcel #\s*/i);
    if (apnLine.segments[1]) bb.assessorParcelNumber = toBBox(apnLine.segments[1], apnLine);
    for (const seg of apnLine.segments) {
      const t = seg.text.trim();
      if (/^Tax Year/i.test(t)) { taxYear = parseNum(extractAfterLabel(seg, /^Tax Year\s*/i)); }
      else if (/^R\.?E\.?\s*Taxes\s*\$/i.test(t)) { realEstateTaxes = parseNum(extractAfterLabel(seg, /^R\.?E\.?\s*Taxes\s*\$\s*/i)); bb.realEstateTaxes = toBBox(seg, apnLine); }
    }
  }

  const nbLine = findLine(lines, /^Neighborhood Name/i);
  let neighborhoodName = "", mapReference = "", censusTract = "";
  if (nbLine) {
    neighborhoodName = labelNextValue(nbLine, /^Neighborhood Name\s*/i);
    mapReference = labelNextValue(nbLine, /^Map Reference\s*/i);
    censusTract = labelNextValue(nbLine, /^Census Tract\s*/i);
    if (nbLine.segments[1]) bb.neighborhoodName = toBBox(nbLine.segments[1], nbLine);
  }

  const occLine = findLine(lines, /^Occupant/i);
  let specialAssessments: number | null = null, hoaAmount: number | null = null, hoaPeriod = "";
  if (occLine) {
    for (const seg of occLine.segments) {
      const t = seg.text.trim();
      if (/^Special Assessments\s*\$/i.test(t)) specialAssessments = parseNum(extractAfterLabel(seg, /^Special Assessments\s*\$\s*/i));
      else if (/HOA\s*\$/i.test(t)) { hoaAmount = parseNum(t.replace(/^.*HOA\s*\$\s*/i, "")); }
      else if (/^per (year|month)/i.test(t)) hoaPeriod = t;
    }
  }
  const occupant = occLine ? resolveCheckbox(checked, occLine.y, [
    { x: 120, label: "Owner" },
    { x: 152, label: "Tenant" },
    { x: 186, label: "Vacant" },
  ]) : "";

  const prLine = findLine(lines, /^Property Rights Appraised/i);
  const propertyRightsAppraised = prLine ? resolveCheckbox(checked, prLine.y, [
    { x: 162, label: "Fee Simple" },
    { x: 209, label: "Leasehold" },
    { x: 254, label: "Other" },
  ]) : "";

  const assignLine = findLine(lines, /^Assignment Type/i);
  let assignmentType = "";
  if (assignLine) {
    assignmentType = resolveCheckbox(checked, assignLine.y, [
      { x: 143, label: "Purchase Transaction" },
      { x: 215, label: "Refinance Transaction" },
      { x: 289, label: "Other" },
    ]);
    if (assignmentType === "Other") {
      const otherSeg = assignLine.segments.find((s) => /Other \(describe\)/i.test(s.text));
      const desc = otherSeg ? otherSeg.text.replace(/^Other \(describe\)\s*/i, "").trim() : "";
      if (desc) assignmentType = `Other: ${desc}`;
    }
  }

  const lenderLine = findLine(lines, /^Lender\/Client\s/i);
  let lenderClient = "", lenderAddress = "";
  if (lenderLine) {
    lenderClient = labelNextValue(lenderLine, /^Lender\/Client\s*/i);
    lenderAddress = labelNextValue(lenderLine, /^Address\s*/i);
    if (lenderLine.segments[1]) bb.lenderClient = toBBox(lenderLine.segments[1], lenderLine);
  }

  return {
    propertyAddress, city, state, zipCode, borrower, ownerOfPublicRecord, county,
    legalDescription, assessorParcelNumber, taxYear, realEstateTaxes,
    neighborhoodName, mapReference, censusTract, occupant, specialAssessments,
    hoaAmount, hoaPeriod, propertyRightsAppraised, assignmentType, lenderClient, lenderAddress,
    boundingBoxes: bb,
  };
}

// ── Contract ─────────────────────────────────────────────────────────────

export function parseContractSection(lines: TextLine[], checked: CheckedPosition[]): ContractSection {
  const bb: Record<string, BoundingBox> = {};

  const offeredLine = findLine(lines, /currently offered for sale/i);
  const isOfferedForSale = offeredLine ? resolveCheckbox(checked, offeredLine.y, [
    { x: 470, label: "Yes" }, { x: 496, label: "No" },
  ]) : "";

  const dsLine = findLine(lines, /^Report data source/i);
  let reportDataSources = "";
  if (dsLine) {
    const valueSeg = dsLine.segments.find((s) => s.x > 180);
    if (valueSeg) { reportDataSources = valueSeg.text.trim(); bb.reportDataSources = toBBox(valueSeg, dsLine); }
    const idx = lines.indexOf(dsLine);
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^I\s+(did|did not)/i.test(lines[i].fullText) || /^Contract Price/i.test(lines[i].fullText)) break;
      reportDataSources += " " + lines[i].fullText.trim();
    }
    reportDataSources = reportDataSources.trim();
  }

  const analysisLine = findLine(lines, /did not analyze the contract/i);
  let contractAnalysis = "";
  if (analysisLine) {
    const idx = lines.indexOf(analysisLine);
    const parts: string[] = [];
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^Contract Price/i.test(lines[i].fullText)) break;
      const t = lines[i].fullText.trim();
      if (t && !/^performed\.?$/i.test(t)) parts.push(t);
    }
    contractAnalysis = parts.join(" ").trim();
  }

  const contractLine = findLine(lines, /^Contract Price\s*\$/i);
  let contractPrice: number | null = null, dateOfContract = "";
  if (contractLine) {
    for (const seg of contractLine.segments) {
      const t = seg.text.trim();
      if (/^Contract Price\s*\$/i.test(t)) { contractPrice = parseNum(extractAfterLabel(seg, /^Contract Price\s*\$\s*/i)); bb.contractPrice = toBBox(seg, contractLine); }
      else if (/^Date of Contract\s/i.test(t)) { dateOfContract = extractAfterLabel(seg, /^Date of Contract\s+/i); }
    }
  }
  const sellerLine = findLine(lines, /Is the property seller the owner of public record/i);
  const sellerIsOwnerOfRecord = sellerLine ? resolveCheckbox(checked, sellerLine.y, [
    { x: 394, label: "Yes" }, { x: 417, label: "No" },
  ]) : "";

  const finLine = findLine(lines, /Is there any financial assistance/i);
  const financialAssistance = finLine ? resolveCheckbox(checked, finLine.y, [
    { x: 501, label: "Yes" }, { x: 529, label: "No" },
  ]) : "";

  return { isOfferedForSale, reportDataSources, contractAnalysis, contractPrice, dateOfContract, sellerIsOwnerOfRecord, financialAssistance, boundingBoxes: bb };
}

// ── Neighborhood ─────────────────────────────────────────────────────────

export function parseNeighborhoodSection(lines: TextLine[], checked: CheckedPosition[]): NeighborhoodSection {
  const bb: Record<string, BoundingBox> = {};

  const locationLine = findLine(lines, /^Location/i);
  const builtUpLine = findLine(lines, /^Built-Up/i);
  const growthLine = findLine(lines, /^Growth/i);

  const location = locationLine ? resolveCheckbox(checked, locationLine.y, [
    { x: 118, label: "Urban" }, { x: 157, label: "Suburban" }, { x: 197, label: "Rural" },
  ]) : "";
  const propertyValues = locationLine ? resolveCheckbox(checked, locationLine.y, [
    { x: 283, label: "Increasing" }, { x: 331, label: "Stable" }, { x: 371, label: "Declining" },
  ]) : "";
  const builtUp = builtUpLine ? resolveCheckbox(checked, builtUpLine.y, [
    { x: 118, label: "Over 75%" }, { x: 157, label: "25-75%" }, { x: 197, label: "Under 25%" },
  ]) : "";
  const demandSupply = builtUpLine ? resolveCheckbox(checked, builtUpLine.y, [
    { x: 283, label: "Shortage" }, { x: 331, label: "In Balance" }, { x: 371, label: "Over Supply" },
  ]) : "";
  const growth = growthLine ? resolveCheckbox(checked, growthLine.y, [
    { x: 118, label: "Rapid" }, { x: 157, label: "Stable" }, { x: 197, label: "Slow" },
  ]) : "";
  const marketingTime = growthLine ? resolveCheckbox(checked, growthLine.y, [
    { x: 283, label: "Under 3 mths" }, { x: 331, label: "3-6 mths" }, { x: 371, label: "Over 6 mths" },
  ]) : "";

  // Price ($000) and age (yrs) columns sit around x 410-470. Values are embedded
  // in segments like "85 Low", "484 High 81 Commercial", "375 Pred. 1 Other".
  let priceLow: number | null = null, priceHigh: number | null = null, pricePredominant: number | null = null;
  let ageLow: number | null = null, ageHigh: number | null = null, agePredominant: number | null = null;
  // Price ($000) and age (yrs) share segments like "85 Low", "0 Multi-Family",
  // "484 High 81 Commercial", "375 Pred. 1 Other" in the x 405-490 band.
  for (const l of lines) {
    for (const seg of l.segments) {
      if (seg.x < 405 || seg.x > 490) continue;
      const t = seg.text.trim();
      let m: RegExpMatchArray | null;
      if ((m = t.match(/([\d,]+)\s+Low\b/i))) priceLow = parseNum(m[1]);
      if ((m = t.match(/([\d,]+)\s+High\b/i))) { priceHigh = parseNum(m[1]); const a = t.match(/High\s+(\d+)\s+Commercial/i); if (a) ageHigh = parseNum(a[1]); }
      if ((m = t.match(/([\d,]+)\s+Pred\.?/i))) { pricePredominant = parseNum(m[1]); const a = t.match(/Pred\.?\s+(\d+)\s+Other/i); if (a) agePredominant = parseNum(a[1]); }
      if ((m = t.match(/^(\d+)\s+Multi/i))) ageLow = parseNum(m[1]);
    }
  }

  // Land use percentages (right-most column, x >= 520)
  let landUseOneUnit: number | null = null, landUseTwoFourUnit: number | null = null;
  let landUseMultiFamily: number | null = null, landUseCommercial: number | null = null, landUseOther: number | null = null;
  for (const l of lines) {
    for (const seg of l.segments) {
      if (seg.x < 520) continue;
      const pct = seg.text.match(/(\d+)\s*%/);
      if (!pct) continue;
      const val = parseNum(pct[1]);
      if (/One-Unit/i.test(l.fullText) && landUseOneUnit === null) landUseOneUnit = val;
      else if (/2-4 Unit/i.test(l.fullText) && landUseTwoFourUnit === null) landUseTwoFourUnit = val;
      else if (/Multi-Family/i.test(l.fullText) && landUseMultiFamily === null) landUseMultiFamily = val;
      else if (/Commercial/i.test(l.fullText) && landUseCommercial === null) landUseCommercial = val;
      else if (/Other/i.test(l.fullText) && landUseOther === null) landUseOther = val;
    }
  }

  const boundaryLine = findLine(lines, /^Neighborhood Boundaries/i);
  let boundaries = "";
  if (boundaryLine) {
    const valueSeg = boundaryLine.segments.find((s) => s.x > 140 && s.x < 405);
    if (valueSeg) { boundaries = valueSeg.text.trim(); bb.boundaries = toBBox(valueSeg, boundaryLine); }
  }

  const descLine = findLine(lines, /^Neighborhood Description/i);
  let description = "";
  if (descLine) {
    const idx = lines.indexOf(descLine);
    const valueSeg = descLine.segments.find((s) => s.x > 140);
    const parts: string[] = [];
    if (valueSeg) { parts.push(valueSeg.text.trim()); bb.description = toBBox(valueSeg, descLine); }
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^Market Conditions/i.test(lines[i].fullText)) break;
      parts.push(lines[i].fullText.trim());
    }
    description = parts.join(" ").trim();
  }

  const mcLine = findLine(lines, /^Market Conditions\s*\(/i);
  let marketConditions = "";
  if (mcLine) {
    const valueSeg = mcLine.segments.find((s) => s.x > 200);
    if (valueSeg) { marketConditions = valueSeg.text.trim(); bb.marketConditions = toBBox(valueSeg, mcLine); }
  }

  return {
    location, builtUp, growth, propertyValues, demandSupply, marketingTime,
    priceLow, priceHigh, pricePredominant, ageLow, ageHigh, agePredominant,
    landUseOneUnit, landUseTwoFourUnit, landUseMultiFamily, landUseCommercial, landUseOther,
    boundaries, description, marketConditions, boundingBoxes: bb,
  };
}

// ── Site ─────────────────────────────────────────────────────────────────

export function parseSiteSection(lines: TextLine[], checked: CheckedPosition[]): SiteSection {
  const bb: Record<string, BoundingBox> = {};

  const dimLine = findLine(lines, /^Dimensions/i);
  let dimensions = "", area = "", shape = "", view = "";
  if (dimLine) {
    for (const seg of dimLine.segments) {
      const t = seg.text.trim();
      if (/^Dimensions\s/i.test(t)) { dimensions = extractAfterLabel(seg, /^Dimensions\s+/i); bb.dimensions = toBBox(seg, dimLine); }
      else if (/^Area\s/i.test(t)) area = extractAfterLabel(seg, /^Area\s+/i);
      else if (/^Shape\s/i.test(t)) shape = extractAfterLabel(seg, /^Shape\s+/i);
      else if (/^View\s/i.test(t)) view = extractAfterLabel(seg, /^View\s+/i);
    }
  }

  const zonLine = findLine(lines, /^Specific Zoning Classification/i);
  let zoningClassification = "", zoningDescription = "";
  if (zonLine) {
    zoningClassification = labelNextValue(zonLine, /^Specific Zoning Classification\s*/i);
    const zdSeg = zonLine.segments.find((s) => /^Zoning Description/i.test(s.text));
    if (zdSeg) zoningDescription = extractAfterLabel(zdSeg, /^Zoning Description\s+/i);
  }

  const compLine = findLine(lines, /^Zoning Compliance/i);
  let zoningCompliance = "";
  if (compLine) {
    zoningCompliance = resolveCheckbox(checked, compLine.y, [
      { x: 143, label: "Legal" },
      { x: 171, label: "Legal Nonconforming" },
      { x: 289, label: "No Zoning" },
      { x: 329, label: "Illegal" },
    ]);
  }

  const hbuLine = findLine(lines, /highest and best use/i);
  const highestAndBestUse = hbuLine ? resolveCheckbox(checked, hbuLine.y, [
    { x: 408, label: "Yes" }, { x: 435, label: "No" },
  ]) : "";

  const femaLine = findLine(lines, /FEMA Special Flood/i);
  let femaFloodZone = "", femaMapNumber = "", femaMapDate = "";
  if (femaLine) {
    for (const seg of femaLine.segments) {
      const t = seg.text.trim();
      if (/FEMA Flood Zone\s/i.test(t)) femaFloodZone = extractAfterLabel(seg, /.*?FEMA Flood Zone\s+/i);
      else if (/^FEMA Map #\s/i.test(t)) { femaMapNumber = extractAfterLabel(seg, /^FEMA Map #\s+/i); bb.femaMapNumber = toBBox(seg, femaLine); }
      else if (/^FEMA Map Date\s/i.test(t)) femaMapDate = extractAfterLabel(seg, /^FEMA Map Date\s+/i);
    }
  }
  const femaSpecialFloodHazardArea = femaLine ? resolveCheckbox(checked, femaLine.y, [
    { x: 182, label: "Yes" }, { x: 207, label: "No" },
  ]) : "";

  const adverseLine = findLine(lines, /adverse site conditions/i);
  let adverseConditions = adverseLine ? resolveCheckbox(checked, adverseLine.y, [
    { x: 431, label: "Yes" }, { x: 459, label: "No" },
  ]) : "";

  return { dimensions, area, shape, view, zoningClassification, zoningDescription, zoningCompliance, highestAndBestUse, femaSpecialFloodHazardArea, femaFloodZone, femaMapNumber, femaMapDate, adverseConditions, boundingBoxes: bb };
}

// ── Improvements (Pages 1-2) ─────────────────────────────────────────────

export function parseImprovementsSection(
  page1: TextLine[],
  page2: TextLine[],
  checkedP1: CheckedPosition[],
  checkedP2: CheckedPosition[],
): ImprovementsSection {
  const bb: Record<string, BoundingBox> = {};

  const unitsLine = findLine(page1, /^Units/i);
  const units = unitsLine ? resolveCheckbox(checkedP1, unitsLine.y, [
    { x: 115, label: "Two" }, { x: 140, label: "Three" }, { x: 170, label: "Four" },
  ]) : "";
  const foundation = unitsLine ? resolveCheckbox(checkedP1, unitsLine.y, [
    { x: 207, label: "Concrete Slab" }, { x: 262, label: "Crawl Space" },
  ]) : "";

  const storiesLine = findLine(page1, /^# of Stories/i);
  let numberOfStories: number | null = null, numberOfBuildings: number | null = null;
  if (storiesLine) {
    const m = storiesLine.fullText.match(/# of Stories\s+([\d.]+)/i);
    if (m) numberOfStories = parseNum(m[1]);
    const b = storiesLine.fullText.match(/# of bldgs\.\s+(\d+)/i);
    if (b) numberOfBuildings = parseNum(b[1]);
  }

  const typeLine = findLine(page1, /^Type\b/i);
  const type = typeLine ? resolveCheckbox(checkedP1, typeLine.y, [
    { x: 108, label: "Det." }, { x: 131, label: "Att." }, { x: 155, label: "S-Det./End Unit" },
  ]) : "";

  const existLine = findLine(page1, /^Existing/i);
  const existingProposed = existLine ? resolveCheckbox(checkedP1, existLine.y, [
    { x: 92, label: "Existing" }, { x: 125, label: "Proposed" }, { x: 162, label: "Under Const." },
  ]) : "";

  const designLine = findLine(page1, /^Design \(Style\)/i);
  const designStyle = labelNextValue(designLine, /^Design \(Style\)\s*/i);

  const yearLine = findLine(page1, /^Year Built/i);
  const yearBuilt = yearLine ? parseNum(labelNextValue(yearLine, /^Year Built\s*/i)) : null;

  const effLine = findLine(page1, /^Effective Age/i);
  const effectiveAge = effLine ? parseNum(labelNextValue(effLine, /^Effective Age \(Yrs\)\s*/i)) : null;

  // Material fields — value is the segment column immediately after the label.
  const mat = (label: RegExp) => {
    for (const l of page1) {
      const idx = l.segments.findIndex((s) => label.test(s.text));
      if (idx >= 0) {
        const next = l.segments[idx + 1];
        if (next) return next.text.trim();
      }
    }
    return "";
  };
  const foundationWalls = mat(/^Foundation Walls\s*/i);
  const exteriorWalls = mat(/^Exterior Walls\s*/i);
  const roofSurface = mat(/Roof Surface\s*/i);
  const guttersDownspouts = mat(/^Gutters & Downspouts\s*/i);
  const windowType = mat(/^Window Type\s*/i);
  const stormSashInsulated = mat(/^Storm Sash\/Insulated\s*/i);
  const screens = mat(/^Screens\s*/i);
  const floors = mat(/^Floors\s*/i);
  const walls = mat(/^Walls\s*/i);
  const trimFinish = mat(/^Trim\/Finish\s*/i);
  const bathFloor = mat(/^Bath Floor\s*/i);
  const bathWainscot = mat(/^Bath Wainscot\s*/i);

  // Heating / cooling
  const heatLine = findLine(page1, /^Attic/i);
  const heatingType = heatLine ? resolveCheckbox(checkedP1, heatLine.y, [
    { x: 207, label: "FWA" }, { x: 249, label: "HWBB" }, { x: 290, label: "Radiant" },
  ]) : "";
  const fuelLine = findLine(page1, /Fuel\s/i);
  const heatingFuel = fuelLine ? (fuelLine.segments.find((s) => /^Fuel\s/i.test(s.text))?.text.replace(/^Fuel\s+/i, "").trim() ?? "") : "";
  const coolLine = findLine(page1, /Central Air Conditioning/i);
  const cooling = coolLine ? resolveCheckbox(checkedP1, coolLine.y, [
    { x: 232, label: "Central Air Conditioning" },
  ]) : "";

  // Amenities counts (text)
  const numAfter = (label: RegExp): number | null => {
    for (const l of page1) {
      const m = l.fullText.match(label);
      if (m) return parseNum(m[1]);
    }
    return null;
  };
  const fireplaces = numAfter(/Fireplace\(s\) #\s+(\d+)/i);
  const woodstoves = numAfter(/Woodstove\(s\) #\s+(\d+)/i);
  const drivewayCarCount = numAfter(/Driveway # of Cars\s+(\d+)/i);
  const garageCarCount = numAfter(/Garage\s+# of Cars\s+(\d+)/i);
  const carportCarCount = numAfter(/Carport\s+# of Cars\s+(\d+)/i);

  const patioLine = findLine(page1, /Patio\/Deck/i);
  const patioDeck = patioLine ? (patioLine.fullText.match(/Patio\/Deck\s+(\S+)/i)?.[1] ?? "") : "";
  const poolLine = findLine(page1, /Pool\s/i);
  const pool = poolLine ? (poolLine.fullText.match(/Pool\s+(\S+)/i)?.[1] ?? "") : "";
  const porchLine = findLine(page1, /Porch\s/i);
  const porch = porchLine ? (porchLine.fullText.match(/Porch\s+(\S+)/i)?.[1] ?? "") : "";
  const fenceLine = findLine(page1, /Fence\s/i);
  const fence = fenceLine ? (fenceLine.fullText.match(/Fence\s+(\S+)/i)?.[1] ?? "") : "";
  const drivewaySurface = mat(/Driveway Surface\s*/i);

  // Appliance counts: "# of Appliances Refrigerator 2 Range/Oven 2 Dishwasher 2 ..."
  const applianceLine = findLine(page1, /# of Appliances/i);
  const applianceCount = (label: RegExp): number | null => {
    if (!applianceLine) return null;
    const m = applianceLine.fullText.match(label);
    return m ? parseNum(m[1]) : null;
  };
  const refrigerator = applianceCount(/Refrigerator\s+(\d+)/i);
  const rangeOven = applianceCount(/Range\/Oven\s+(\d+)/i);
  const dishwasher = applianceCount(/Dishwasher\s+(\d+)/i);
  const disposal = applianceCount(/Disposal\s+(\d+)/i);
  const microwave = applianceCount(/Microwave\s+(\d+)/i);
  const washerDryer = applianceCount(/Washer\/Dryer\s+(\d+)/i);

  // Unit breakdown: "Unit # 1 contains: 5 Rooms 2 Bedrooms 2 Bath(s) 1,156 Square Feet ..."
  const unitBreakdown: ImprovementUnit[] = [];
  for (let u = 1; u <= 4; u++) {
    const line = page1.find((l) => new RegExp(`^Unit # ${u} contains`, "i").test(l.fullText));
    if (!line) continue;
    const t = line.fullText;
    const rooms = t.match(/([\d]+)\s*Rooms?/i);
    const beds = t.match(/([\d]+)\s*Bedrooms?/i);
    const baths = t.match(/([\d.]+)\s*Bath\(s\)/i);
    const gla = t.match(/([\d,]+)\s*Square Feet/i);
    const entry: ImprovementUnit = {
      unit: u,
      rooms: rooms ? parseNum(rooms[1]) : null,
      bedrooms: beds ? parseNum(beds[1]) : null,
      baths: baths ? parseNum(baths[1]) : null,
      grossLivingArea: gla ? parseNum(gla[1]) : null,
    };
    if (entry.rooms !== null || entry.grossLivingArea !== null) unitBreakdown.push(entry);
  }

  const featLine = findLine(page1, /^Additional features/i);
  let additionalFeatures = "";
  if (featLine) {
    const valueSeg = featLine.segments.find((s) => s.x > 200);
    if (valueSeg) additionalFeatures = valueSeg.text.trim();
  }

  const condLine = findLine(page1, /^Describe the condition of the property/i);
  let conditionDescription = "";
  if (condLine) {
    const idx = page1.indexOf(condLine);
    const valueSeg = condLine.segments.find((s) => s.x > 350);
    const parts: string[] = [];
    if (valueSeg) parts.push(valueSeg.text.trim());
    for (let i = idx + 1; i < page1.length; i++) {
      if (/^Freddie Mac Form/i.test(page1[i].fullText)) break;
      const t = page1[i].fullText.trim();
      if (t) parts.push(t);
    }
    conditionDescription = parts.join(" ").trim();
  }

  // Page 2: physical deficiencies, conformity, rent control (Yes/No + describe)
  let physicalDeficiencies = "", conformity = "", rentControl = "";
  const pdLine = findLine(page2, /physical deficiencies or adverse conditions/i);
  if (pdLine) physicalDeficiencies = resolveCheckbox(checkedP2, pdLine.y, [{ x: 427, label: "Yes" }, { x: 451, label: "No" }]);
  const confLine = findLine(page2, /Does the property generally conform/i);
  if (confLine) conformity = resolveCheckbox(checkedP2, confLine.y, [{ x: 396, label: "Yes" }, { x: 420, label: "No" }]);
  const rcLine = findLine(page2, /Is the property subject to rent control/i);
  if (rcLine) rentControl = resolveCheckbox(checkedP2, rcLine.y, [{ x: 201, label: "Yes" }, { x: 230, label: "No" }]);

  return {
    units, numberOfStories, numberOfBuildings, foundation, type, existingProposed,
    designStyle, yearBuilt, effectiveAge,
    foundationWalls, exteriorWalls, roofSurface, guttersDownspouts, windowType, stormSashInsulated, screens,
    floors, walls, trimFinish, bathFloor, bathWainscot,
    heatingType, heatingFuel, cooling,
    fireplaces, woodstoves, patioDeck, pool, fence, porch,
    drivewayCarCount, drivewaySurface, garageCarCount, carportCarCount,
    refrigerator, rangeOven, dishwasher, disposal, microwave, washerDryer,
    unitBreakdown, additionalFeatures, conditionDescription,
    physicalDeficiencies, conformity, rentControl,
    boundingBoxes: bb,
  };
}
