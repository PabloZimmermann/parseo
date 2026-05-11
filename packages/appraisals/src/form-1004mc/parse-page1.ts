import { toBBox } from "@parseo/shared";
import type { TextLine, BoundingBox } from "@parseo/shared";
import type {
  SubjectSection,
  ContractSection,
  NeighborhoodSection,
  SiteSection,
  ImprovementsSection,
} from "./types.js";

// ── Utilities ─────────────────────────────────────────────────────────────

function parseNum(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,%]/g, "").replace(/,/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
}

/** Extract value after a label in a segment's text */
function extractAfterLabel(seg: { text: string }, label: RegExp): string {
  return seg.text.replace(label, "").trim();
}

/** Find the first line matching a pattern, optionally within a y-range */
function findLine(
  lines: TextLine[],
  pattern: RegExp,
  opts?: { minY?: number; maxY?: number }
): TextLine | undefined {
  return lines.find((l) => {
    if (opts?.minY !== undefined && l.y < opts.minY) return false;
    if (opts?.maxY !== undefined && l.y > opts.maxY) return false;
    return pattern.test(l.fullText);
  });
}

/** Get the value from a label-value segment like "Label VALUE" */
function labelValue(line: TextLine | undefined, label: RegExp): { value: string; seg?: typeof line extends undefined ? undefined : TextLine["segments"][0] } {
  if (!line) return { value: "" };
  for (const seg of line.segments) {
    if (label.test(seg.text)) {
      return { value: extractAfterLabel(seg, label), seg };
    }
  }
  return { value: "" };
}

/** Get segment at a specific x-range on a line */
function segAtX(line: TextLine, minX: number, maxX: number): string {
  const seg = line.segments.find((s) => s.x >= minX && s.x < maxX);
  return seg ? seg.text.trim() : "";
}

// ── Subject ───────────────────────────────────────────────────────────────

export function parseSubjectSection(lines: TextLine[]): SubjectSection {
  const bb: Record<string, BoundingBox> = {};

  const addrLine = findLine(lines, /^Property Address/i);
  let propertyAddress = "", city = "", state = "", zipCode = "";
  if (addrLine) {
    for (const seg of addrLine.segments) {
      const t = seg.text.trim();
      if (/^Property Address\s/i.test(t)) { propertyAddress = extractAfterLabel(seg, /^Property Address\s+/i); bb.propertyAddress = toBBox(seg, addrLine); }
      else if (/^City\s/i.test(t)) { city = extractAfterLabel(seg, /^City\s+/i); bb.city = toBBox(seg, addrLine); }
      else if (/^State\s/i.test(t)) { state = extractAfterLabel(seg, /^State\s+/i); bb.state = toBBox(seg, addrLine); }
      else if (/^Zip Code\s/i.test(t)) { zipCode = extractAfterLabel(seg, /^Zip Code\s+/i); bb.zipCode = toBBox(seg, addrLine); }
    }
  }

  const borrowerLine = findLine(lines, /^Borrower\s/i);
  let borrower = "", ownerOfPublicRecord = "", county = "";
  if (borrowerLine) {
    for (const seg of borrowerLine.segments) {
      const t = seg.text.trim();
      if (/^Borrower\s/i.test(t)) { borrower = extractAfterLabel(seg, /^Borrower\s+/i); bb.borrower = toBBox(seg, borrowerLine); }
      else if (/^Owner of Public Record\s/i.test(t)) { ownerOfPublicRecord = extractAfterLabel(seg, /^Owner of Public Record\s+/i); bb.ownerOfPublicRecord = toBBox(seg, borrowerLine); }
      else if (/^County\s/i.test(t)) { county = extractAfterLabel(seg, /^County\s+/i); bb.county = toBBox(seg, borrowerLine); }
    }
  }

  const legalLine = findLine(lines, /^Legal Description\s/i);
  const legalDescription = legalLine ? labelValue(legalLine, /^Legal Description\s+/i).value : "";
  if (legalLine?.segments[0]) bb.legalDescription = toBBox(legalLine.segments[0], legalLine);

  const apnLine = findLine(lines, /^Assessor's Parcel #/i);
  let assessorParcelNumber = "", taxYear: number | null = null, realEstateTaxes: number | null = null;
  if (apnLine) {
    for (const seg of apnLine.segments) {
      const t = seg.text.trim();
      if (/^Assessor's Parcel #/i.test(t)) { assessorParcelNumber = extractAfterLabel(seg, /^Assessor's Parcel #\s*/i); bb.assessorParcelNumber = toBBox(seg, apnLine); }
      else if (/^Tax Year/i.test(t)) { taxYear = parseNum(extractAfterLabel(seg, /^Tax Year\s*/i)); bb.taxYear = toBBox(seg, apnLine); }
      else if (/^R\.?E\.?\s*Taxes\s*\$/i.test(t)) { realEstateTaxes = parseNum(extractAfterLabel(seg, /^R\.?E\.?\s*Taxes\s*\$\s*/i)); bb.realEstateTaxes = toBBox(seg, apnLine); }
    }
  }

  const nhLine = findLine(lines, /^Neighborhood Name\s/i);
  let neighborhoodName = "", mapReference = "", censusTract = "";
  if (nhLine) {
    for (const seg of nhLine.segments) {
      const t = seg.text.trim();
      if (/^Neighborhood Name/i.test(t)) { neighborhoodName = extractAfterLabel(seg, /^Neighborhood Name\s+/i); bb.neighborhoodName = toBBox(seg, nhLine); }
      else if (/^Map Reference/i.test(t)) { mapReference = extractAfterLabel(seg, /^Map Reference\s+/i); bb.mapReference = toBBox(seg, nhLine); }
      else if (/^Census Tract/i.test(t)) { censusTract = extractAfterLabel(seg, /^Census Tract\s+/i); bb.censusTract = toBBox(seg, nhLine); }
    }
  }

  const occLine = findLine(lines, /^Occupant/i);
  let occupant = "", specialAssessments: number | null = null, hoaAmount: number | null = null;
  if (occLine) {
    // Occupant type (Owner/Tenant/Vacant) is a checkbox field — all labels
    // appear as static text in flattened PDFs. Leave empty here; resolved
    // via vector-graphic checkbox detection in parser.ts.
    for (const seg of occLine.segments) {
      const t = seg.text.trim();
      if (/^Special Assessments\s*\$/i.test(t)) specialAssessments = parseNum(extractAfterLabel(seg, /^Special Assessments\s*\$\s*/i));
      else if (/^HOA\s*\$/i.test(t)) hoaAmount = parseNum(extractAfterLabel(seg, /^HOA\s*\$\s*/i));
    }
  }

  const prLine = findLine(lines, /^Property Rights Appraised/i);
  let propertyRightsAppraised = "";
  if (prLine) {
    // Value is the segment after the label (e.g. "Fee Simple")
    const prIdx = prLine.segments.findIndex((s) => /^Property Rights Appraised/i.test(s.text.trim()));
    if (prIdx >= 0 && prLine.segments[prIdx + 1]) {
      propertyRightsAppraised = prLine.segments[prIdx + 1].text.trim();
      bb.propertyRightsAppraised = toBBox(prLine.segments[prIdx + 1], prLine);
    }
  }

  const assignLine = findLine(lines, /Assignment Type/i);
  let assignmentType = "";
  if (assignLine) {
    const atIdx = assignLine.segments.findIndex((s) => /Assignment Type/i.test(s.text));
    if (atIdx >= 0 && assignLine.segments[atIdx + 1]) {
      assignmentType = assignLine.segments[atIdx + 1].text.trim();
      bb.assignmentType = toBBox(assignLine.segments[atIdx + 1], assignLine);
    }
  }

  const lenderLine = findLine(lines, /^Lender\/Client\s/i);
  let lenderClient = "", lenderAddress = "";
  if (lenderLine) {
    for (const seg of lenderLine.segments) {
      const t = seg.text.trim();
      if (/^Lender\/Client\s/i.test(t)) { lenderClient = extractAfterLabel(seg, /^Lender\/Client\s+/i); bb.lenderClient = toBBox(seg, lenderLine); }
      else if (/^Address\s/i.test(t)) { lenderAddress = extractAfterLabel(seg, /^Address\s+/i); bb.lenderAddress = toBBox(seg, lenderLine); }
    }
  }

  return {
    propertyAddress, city, state, zipCode, borrower, ownerOfPublicRecord, county,
    legalDescription, assessorParcelNumber, taxYear, realEstateTaxes,
    neighborhoodName, mapReference, censusTract, occupant, specialAssessments,
    hoaAmount, propertyRightsAppraised, assignmentType, lenderClient, lenderAddress,
    boundingBoxes: bb,
  };
}

// ── Contract ──────────────────────────────────────────────────────────────

export function parseContractSection(lines: TextLine[]): ContractSection {
  const bb: Record<string, BoundingBox> = {};

  const offeredLine = findLine(lines, /currently offered for sale/i);
  const isOfferedForSale = offeredLine?.fullText.includes("Yes") && !offeredLine?.fullText.includes("No") ? "Yes" : offeredLine?.fullText.includes("No") ? "No" : "";

  const dataSourceLine = findLine(lines, /^Report data source/i);
  let reportDataSources = "";
  if (dataSourceLine) {
    const valueSeg = dataSourceLine.segments.find((s) => s.x > 180);
    if (valueSeg) { reportDataSources = valueSeg.text.trim(); bb.reportDataSources = toBBox(valueSeg, dataSourceLine); }
  }

  // Contract analysis text (spans multiple lines after "did/did not analyze")
  const analysisLine = findLine(lines, /did not analyze the contract|did.*analyze the contract/i);
  let contractAnalysis = "";
  if (analysisLine) {
    const idx = lines.indexOf(analysisLine);
    const parts = [analysisLine.fullText];
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^Contract Price/i.test(lines[i].fullText)) break;
      parts.push(lines[i].fullText.trim());
    }
    contractAnalysis = parts.join(" ").replace(/^I\s+(did|did not).*?performed\.\s*/is, "").trim();
    bb.contractAnalysis = toBBox(analysisLine.segments[0], analysisLine);
  }

  const contractLine = findLine(lines, /^Contract Price\s*\$/i);
  let contractPrice: number | null = null, dateOfContract = "";
  if (contractLine) {
    for (const seg of contractLine.segments) {
      const t = seg.text.trim();
      if (/^Contract Price\s*\$/i.test(t)) { contractPrice = parseNum(extractAfterLabel(seg, /^Contract Price\s*\$\s*/i)); bb.contractPrice = toBBox(seg, contractLine); }
      else if (/^Date of Contract\s/i.test(t)) { dateOfContract = extractAfterLabel(seg, /^Date of Contract\s+/i); bb.dateOfContract = toBBox(seg, contractLine); }
    }
  }

  const assistLine = findLine(lines, /If Yes, report the total dollar/i);
  let financialAssistanceAmount = "";
  if (assistLine) {
    const valueSeg = assistLine.segments.find((s) => /^\$/.test(s.text.trim()));
    if (valueSeg) { financialAssistanceAmount = valueSeg.text.trim(); bb.financialAssistance = toBBox(valueSeg, assistLine); }
  }

  return { isOfferedForSale, reportDataSources, contractAnalysis, contractPrice, dateOfContract, financialAssistanceAmount, boundingBoxes: bb };
}

// ── Neighborhood ──────────────────────────────────────────────────────────

export function parseNeighborhoodSection(lines: TextLine[]): NeighborhoodSection {
  const bb: Record<string, BoundingBox> = {};

  // Checkbox fields (Location, Built-Up, Growth, Property Values, etc.) have all
  // option labels rendered as static text — the checked state is a graphical vector
  // path and cannot be extracted from text. We leave location empty here; the main
  // parser derives it from the UAD-coded subject location on page 2.
  let location = "";

  // Price and age data from the "Low/High/Pred" area
  const priceLine = findLine(lines, /^\$\s*\(000\)|Low|priceLow/i, { minY: 330 });
  // These values are scattered across the grid lines
  let priceLow: number | null = null, priceHigh: number | null = null, pricePredominant: number | null = null;
  let ageLow: number | null = null, ageHigh: number | null = null, agePredominant: number | null = null;

  // Look for the three grid rows with price/age/land use data
  const growthLine = findLine(lines, /^Growth/i);
  const boundaryLine = findLine(lines, /^Neighborhood Boundaries/i);
  const predLine = lines.find((l) => l.y > (growthLine?.y ?? 0) && /Pred\.?/i.test(l.fullText));

  if (growthLine) {
    // Growth line has: Low price, Low age, Multi-Family %
    const priceSegs = growthLine.segments.filter((s) => s.x >= 430 && s.x < 490);
    if (priceSegs.length > 0) {
      const match = priceSegs[0].text.match(/(\d[\d,]*)\s+Low/i) || priceSegs[0].text.match(/^(\d[\d,]*)/);
      if (match) priceLow = parseNum(match[1]);
      bb.priceLow = toBBox(priceSegs[0], growthLine);
    }
    const ageSegs = growthLine.segments.filter((s) => s.x >= 485 && s.x < 510);
    if (ageSegs.length > 0) {
      ageLow = parseNum(ageSegs[0].text.replace(/\D*$/, ""));
      bb.ageLow = toBBox(ageSegs[0], growthLine);
    }
  }
  if (boundaryLine) {
    const priceSegs = boundaryLine.segments.filter((s) => s.x >= 430 && s.x < 490);
    if (priceSegs.length > 0) {
      const match = priceSegs[0].text.match(/(\d[\d,]*)\s+High/i) || priceSegs[0].text.match(/^(\d[\d,]*)/);
      if (match) priceHigh = parseNum(match[1]);
      bb.priceHigh = toBBox(priceSegs[0], boundaryLine);
    }
    const ageSegs = boundaryLine.segments.filter((s) => s.x >= 485 && s.x < 510);
    if (ageSegs.length > 0) {
      ageHigh = parseNum(ageSegs[0].text.replace(/\D*$/, ""));
      bb.ageHigh = toBBox(ageSegs[0], boundaryLine);
    }
  }
  if (predLine) {
    const priceSegs = predLine.segments.filter((s) => s.x >= 430 && s.x < 490);
    if (priceSegs.length > 0) {
      const match = priceSegs[0].text.match(/(\d[\d,]*)\s+Pred/i) || priceSegs[0].text.match(/^(\d[\d,]*)/);
      if (match) pricePredominant = parseNum(match[1]);
      bb.pricePredominant = toBBox(priceSegs[0], predLine);
    }
    const ageSegs = predLine.segments.filter((s) => s.x >= 485 && s.x < 510);
    if (ageSegs.length > 0) {
      agePredominant = parseNum(ageSegs[0].text.replace(/\D*$/, ""));
      bb.agePredominant = toBBox(ageSegs[0], predLine);
    }
  }

  // Land use percentages from the rightmost column
  let landUseOneUnit: number | null = null, landUseTwoFourUnit: number | null = null;
  let landUseMultiFamily: number | null = null, landUseCommercial: number | null = null, landUseOther: number | null = null;
  for (const l of lines) {
    if (l.y < 320 || l.y > 390) continue;
    for (const seg of l.segments) {
      if (seg.x < 505) continue;
      const pct = seg.text.match(/(\d+)\s*%/);
      if (!pct) continue;
      const val = parseNum(pct[1]);
      const label = l.segments.find((s) => s.x >= 505 && s.x < 575 && /One-Unit|2-4 Unit|Multi-?Family|Commercial|Other/i.test(s.text));
      const labelText = label?.text ?? l.fullText;
      if (/One-Unit/i.test(labelText)) { landUseOneUnit = val; bb.landUseOneUnit = toBBox(seg, l); }
      else if (/2-4 Unit/i.test(labelText)) { landUseTwoFourUnit = val; bb.landUseTwoFourUnit = toBBox(seg, l); }
      else if (/Multi/i.test(labelText)) { landUseMultiFamily = val; bb.landUseMultiFamily = toBBox(seg, l); }
      else if (/Commercial/i.test(labelText)) { landUseCommercial = val; bb.landUseCommercial = toBBox(seg, l); }
      else if (/Other/i.test(labelText)) { landUseOther = val; bb.landUseOther = toBBox(seg, l); }
    }
  }

  // Neighborhood boundaries
  const boundLine = findLine(lines, /^Neighborhood Boundaries/i);
  let boundaries = "";
  if (boundLine) {
    const valueSeg = boundLine.segments.find((s) => s.x > 100);
    if (valueSeg) { boundaries = valueSeg.text.trim(); bb.boundaries = toBBox(valueSeg, boundLine); }
    // May continue on next line
    const idx = lines.indexOf(boundLine);
    if (idx >= 0 && lines[idx + 1] && lines[idx + 1].y < (boundLine.y + 20)) {
      const nextSeg = lines[idx + 1].segments.find((s) => s.x < 430);
      if (nextSeg) boundaries += " " + nextSeg.text.trim();
    }
  }

  // Neighborhood description
  const descLine = findLine(lines, /^Neighborhood Description/i);
  let description = "";
  if (descLine) {
    const idx = lines.indexOf(descLine);
    const parts: string[] = [];
    const valueSeg = descLine.segments.find((s) => s.x > 100);
    if (valueSeg) { parts.push(valueSeg.text.trim()); bb.description = toBBox(valueSeg, descLine); }
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^Market Conditions|^Dimensions|^NEIGHBORHOOD$/i.test(lines[i].fullText.trim()) && !/NEIGHBORHOOD CALLED/i.test(lines[i].fullText)) {
        if (lines[i].segments.every((s) => s.x < 430)) break;
      }
      const txt = lines[i].segments.filter((s) => s.x < 430).map((s) => s.text.trim()).join(" ");
      if (txt && !/^NEIGHBORHOOD$/i.test(txt.trim())) parts.push(txt);
      if (/^Market Conditions/i.test(lines[i].fullText)) break;
    }
    description = parts.join(" ").trim();
  }

  // Market conditions
  const mcLine = findLine(lines, /^Market Conditions\s*\(/i);
  let marketConditions = "";
  if (mcLine) {
    const idx = lines.indexOf(mcLine);
    const valueSeg = mcLine.segments.find((s) => s.x > 200);
    const parts: string[] = [];
    if (valueSeg) { parts.push(valueSeg.text.trim()); bb.marketConditions = toBBox(valueSeg, mcLine); }
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^Dimensions|^THIS OPINION/i.test(lines[i].fullText)) {
        if (/^THIS OPINION/i.test(lines[i].fullText)) parts.push(lines[i].fullText.trim());
        break;
      }
      parts.push(lines[i].fullText.trim());
    }
    marketConditions = parts.join(" ").trim();
  }

  return {
    location, builtUp: "", growth: "", propertyValues: "", demandSupply: "", marketingTime: "",
    priceLow, priceHigh, pricePredominant, ageLow, ageHigh, agePredominant,
    landUseOneUnit, landUseTwoFourUnit, landUseMultiFamily, landUseCommercial, landUseOther,
    boundaries, description, marketConditions, boundingBoxes: bb,
  };
}

// ── Site ──────────────────────────────────────────────────────────────────

export function parseSiteSection(lines: TextLine[]): SiteSection {
  const bb: Record<string, BoundingBox> = {};

  const dimLine = findLine(lines, /^Dimensions\s/i);
  let dimensions = "", area = "", shape = "", view = "";
  if (dimLine) {
    for (const seg of dimLine.segments) {
      const t = seg.text.trim();
      if (/^Dimensions\s/i.test(t)) { dimensions = extractAfterLabel(seg, /^Dimensions\s+/i); bb.dimensions = toBBox(seg, dimLine); }
      else if (/^Area\s/i.test(t)) { area = extractAfterLabel(seg, /^Area\s+/i); bb.area = toBBox(seg, dimLine); }
      else if (/^Shape\s/i.test(t)) { shape = extractAfterLabel(seg, /^Shape\s+/i); bb.shape = toBBox(seg, dimLine); }
      else if (/^View\s/i.test(t)) { view = extractAfterLabel(seg, /^View\s+/i); bb.view = toBBox(seg, dimLine); }
    }
  }

  const zonLine = findLine(lines, /^Specific Zoning Classification/i);
  let zoningClassification = "", zoningDescription = "";
  if (zonLine) {
    for (const seg of zonLine.segments) {
      const t = seg.text.trim();
      if (/^Specific Zoning Classification/i.test(t)) { zoningClassification = extractAfterLabel(seg, /^Specific Zoning Classification\s+/i); bb.zoningClassification = toBBox(seg, zonLine); }
      else if (/^Zoning Description/i.test(t)) { zoningDescription = extractAfterLabel(seg, /^Zoning Description\s+/i); bb.zoningDescription = toBBox(seg, zonLine); }
    }
  }

  const compLine = findLine(lines, /^Zoning Compliance/i);
  let zoningCompliance = "";
  if (compLine) {
    const compIdx = compLine.segments.findIndex((s) => /^Zoning Compliance/i.test(s.text.trim()));
    if (compIdx >= 0 && compLine.segments[compIdx + 1]) {
      zoningCompliance = compLine.segments[compIdx + 1].text.trim();
      bb.zoningCompliance = toBBox(compLine.segments[compIdx + 1], compLine);
    }
  }

  const hbuLine = findLine(lines, /highest and best use/i);
  const highestAndBestUse = hbuLine?.fullText.includes("SEE ATTACHED") ? "SEE ATTACHED" : hbuLine?.fullText.includes("Yes") ? "Yes" : "";

  const femaLine = findLine(lines, /^FEMA Special Flood/i);
  let femaFloodZone = "", femaMapNumber = "", femaMapDate = "";
  if (femaLine) {
    for (const seg of femaLine.segments) {
      const t = seg.text.trim();
      if (/FEMA Flood Zone\s/i.test(t)) femaFloodZone = extractAfterLabel(seg, /.*?FEMA Flood Zone\s+/i);
      else if (/FEMA Map #\s/i.test(t)) { femaMapNumber = extractAfterLabel(seg, /^FEMA Map #\s+/i); bb.femaMapNumber = toBBox(seg, femaLine); }
      else if (/FEMA Map Date\s/i.test(t)) { femaMapDate = extractAfterLabel(seg, /^FEMA Map Date\s+/i); bb.femaMapDate = toBBox(seg, femaLine); }
    }
  }

  // Adverse conditions text
  const adverseLine = findLine(lines, /adverse site conditions/i);
  let adverseConditions = "";
  if (adverseLine) {
    const idx = lines.indexOf(adverseLine);
    const parts: string[] = [];
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^General Description|^Units/i.test(lines[i].fullText)) break;
      const txt = lines[i].fullText.trim();
      if (txt && !/^CURRENT LAND SURVEY/.test(txt)) parts.push(txt);
      else if (/^CURRENT LAND SURVEY/.test(txt)) { parts.push(txt); break; }
    }
    adverseConditions = parts.join(" ").trim();
    if (adverseLine.segments[0]) bb.adverseConditions = toBBox(adverseLine.segments[0], adverseLine);
  }

  return { dimensions, area, shape, view, zoningClassification, zoningDescription, zoningCompliance, highestAndBestUse, femaFloodZone, femaMapNumber, femaMapDate, adverseConditions, boundingBoxes: bb };
}

// ── Improvements ──────────────────────────────────────────────────────────

export function parseImprovementsSection(lines: TextLine[]): ImprovementsSection {
  const bb: Record<string, BoundingBox> = {};

  const storiesLine = findLine(lines, /^# of Stories/i);
  let stories: number | null = null;
  if (storiesLine) {
    const seg = storiesLine.segments.find((s) => /^# of Stories/i.test(s.text));
    if (seg) {
      const next = storiesLine.segments.find((s) => s.x > seg.x && s.x < 180);
      if (next) { stories = parseNum(next.text); bb.stories = toBBox(next, storiesLine); }
      else { stories = parseNum(extractAfterLabel(seg, /^# of Stories\s*/i)); bb.stories = toBBox(seg, storiesLine); }
    }
  }

  const designLine = findLine(lines, /^Design \(Style\)/i);
  let designStyle = "";
  if (designLine) {
    const seg = designLine.segments.find((s) => /^Design \(Style\)/i.test(s.text));
    if (seg) {
      const next = designLine.segments.find((s) => s.x > seg.x && s.x < 180);
      if (next) { designStyle = next.text.trim(); bb.designStyle = toBBox(next, designLine); }
      else { designStyle = extractAfterLabel(seg, /^Design \(Style\)\s*/i); bb.designStyle = toBBox(seg, designLine); }
    }
  }

  const yrLine = findLine(lines, /^Year Built/i);
  let yearBuilt: number | null = null;
  if (yrLine) {
    const seg = yrLine.segments.find((s) => /^Year Built/i.test(s.text));
    if (seg) {
      const next = yrLine.segments.find((s) => s.x > seg.x && s.x < 170);
      if (next) { yearBuilt = parseNum(next.text); bb.yearBuilt = toBBox(next, yrLine); }
      else { yearBuilt = parseNum(extractAfterLabel(seg, /^Year Built\s*/i)); bb.yearBuilt = toBBox(seg, yrLine); }
    }
  }

  const effLine = findLine(lines, /^Effective Age/i);
  let effectiveAge: number | null = null;
  if (effLine) {
    const match = effLine.fullText.match(/Effective Age \(Yrs\)\s+(\d+)/i);
    if (match) effectiveAge = parseNum(match[1]);
  }

  // Exterior & Interior descriptions from the grid columns
  // Foundation Walls, Exterior Walls, Roof, etc are in the ~x:311-400 and ~x:465+ ranges
  function findMaterialCondition(label: RegExp): string {
    for (const l of lines) {
      if (l.y < 615 || l.y > 760) continue;
      for (const seg of l.segments) {
        if (label.test(seg.text)) {
          // Value is after the label on same line in the material/condition column
          const val = seg.text.replace(label, "").trim();
          if (val) { bb[label.source.replace(/[^a-zA-Z]/g, "")] = toBBox(seg, l); return val; }
          // Or the next segment
          const idx = l.segments.indexOf(seg);
          if (l.segments[idx + 1]) return l.segments[idx + 1].text.trim();
        }
      }
    }
    return "";
  }

  const foundationWalls = findMaterialCondition(/^Foundation Walls\s*/i);
  const exteriorWalls = findMaterialCondition(/^Exterior Walls\s*/i);
  const roofSurface = findMaterialCondition(/^Roof Surface\s*/i);
  const guttersDownspouts = findMaterialCondition(/^Gutters & Downspouts\s*/i);
  const windowType = findMaterialCondition(/^Window Type\s*/i);
  const floors = findMaterialCondition(/^Floors\s*/i);
  const walls = findMaterialCondition(/^Walls\s*/i);
  const trimFinish = findMaterialCondition(/^Trim\/Finish\s*/i);
  const bathFloor = findMaterialCondition(/^Bath Floor\s*/i);
  const bathWainscot = findMaterialCondition(/^Bath Wainscot\s*/i);

  // Heating
  const heatLine = findLine(lines, /Heating/i, { minY: 700 });
  let heatingType = "", heatingFuel = "";
  if (heatLine) {
    if (/FWA/i.test(heatLine.fullText)) heatingType = "FWA";
    else if (/HWBB/i.test(heatLine.fullText)) heatingType = "HWBB";
    else if (/Radiant/i.test(heatLine.fullText)) heatingType = "Radiant";
    const fuelSeg = heatLine.segments.find((s) => /Fuel\s/i.test(s.text));
    if (fuelSeg) heatingFuel = extractAfterLabel(fuelSeg, /.*?Fuel\s+/i);
  }

  const coolLine = findLine(lines, /Cooling/i, { minY: 720 });
  let coolingType = "";
  if (coolLine && /Central Air/i.test(coolLine.fullText)) coolingType = "Central";
  else if (coolLine && /Individual/i.test(coolLine.fullText)) coolingType = "Individual";

  // Amenities
  let fireplaces: number | null = null, patioOrDeck = "", pool = "", fence = "", porch = "";
  for (const l of lines) {
    if (l.y < 710 || l.y > 755) continue;
    for (const seg of l.segments) {
      const t = seg.text.trim();
      if (/^Fireplace\(s\) #\s/i.test(t)) fireplaces = parseNum(extractAfterLabel(seg, /^Fireplace\(s\) #\s*/i));
      else if (/^Patio\/Deck\s/i.test(t)) { patioOrDeck = extractAfterLabel(seg, /^Patio\/Deck\s+/i); bb.patioOrDeck = toBBox(seg, l); }
      else if (/^Pool\s/i.test(t)) { pool = extractAfterLabel(seg, /^Pool\s+/i); bb.pool = toBBox(seg, l); }
      else if (/^Fence\s/i.test(t)) { fence = extractAfterLabel(seg, /^Fence\s+/i); bb.fence = toBBox(seg, l); }
      else if (/^Porch\s/i.test(t)) { porch = extractAfterLabel(seg, /^Porch\s+/i); bb.porch = toBBox(seg, l); }
    }
  }

  // Car storage
  let drivewayCarCount: number | null = null, drivewaySurface = "", garageCarCount: number | null = null, carportCarCount: number | null = null;
  for (const l of lines) {
    if (l.y < 685 || l.y > 755) continue;
    for (const seg of l.segments) {
      const t = seg.text.trim();
      if (/^Driveway Surface\s/i.test(t)) drivewaySurface = extractAfterLabel(seg, /^Driveway Surface\s+/i);
    }
    // # of Cars values are at x ~566
    const carsSegs = l.segments.filter((s) => s.x >= 555 && s.x < 590 && /^\d+$/.test(s.text.trim()));
    if (carsSegs.length > 0) {
      if (/Driveway.*# of Cars/i.test(l.fullText)) drivewayCarCount = parseNum(carsSegs[0].text);
      else if (/Garage.*# of Cars/i.test(l.fullText)) garageCarCount = parseNum(carsSegs[0].text);
      else if (/Carport.*# of Cars/i.test(l.fullText)) carportCarCount = parseNum(carsSegs[0].text);
    }
  }

  // Room count line
  const roomLine = findLine(lines, /^Finished area above grade/i);
  let roomCount: number | null = null, bedrooms: number | null = null, baths: number | null = null, grossLivingArea: number | null = null;
  if (roomLine) {
    for (const seg of roomLine.segments) {
      const t = seg.text.trim();
      const roomMatch = t.match(/^(\d+)\s*Rooms?/i);
      if (roomMatch) { roomCount = parseNum(roomMatch[1]); bb.roomCount = toBBox(seg, roomLine); }
      const bedMatch = t.match(/^(\d+)\s*Bedrooms?/i);
      if (bedMatch) { bedrooms = parseNum(bedMatch[1]); bb.bedrooms = toBBox(seg, roomLine); }
      const bathMatch = t.match(/^([\d.]+)\s*Bath/i);
      if (bathMatch) { baths = parseNum(bathMatch[1]); bb.baths = toBBox(seg, roomLine); }
      const sqftMatch = t.match(/^([\d,]+)\s*Square Feet/i);
      if (sqftMatch) { grossLivingArea = parseNum(sqftMatch[1]); bb.grossLivingArea = toBBox(seg, roomLine); }
    }
  }

  // Additional features
  const featLine = findLine(lines, /^Additional features/i);
  let additionalFeatures = "";
  if (featLine) {
    const valueSeg = featLine.segments.find((s) => s.x > 180);
    if (valueSeg) { additionalFeatures = valueSeg.text.trim(); bb.additionalFeatures = toBBox(valueSeg, featLine); }
  }

  // Condition description
  const condLine = findLine(lines, /^Describe the condition|^IMPROVEMENTS.*Describe the condition/i);
  let conditionDescription = "";
  if (condLine) {
    const idx = lines.indexOf(condLine);
    const parts: string[] = [];
    // Check if value is on same line at high x
    const valueSeg = condLine.segments.find((s) => s.x > 350);
    if (valueSeg) parts.push(valueSeg.text.trim());
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^Are there any physical deficiencies/i.test(lines[i].fullText)) break;
      parts.push(lines[i].fullText.trim());
    }
    conditionDescription = parts.join(" ").trim();
    if (condLine.segments[0]) bb.conditionDescription = toBBox(condLine.segments[0], condLine);
  }

  // Physical deficiencies
  const defLine = findLine(lines, /^Are there any physical deficiencies/i);
  let physicalDeficiencies = "";
  if (defLine) {
    const idx = lines.indexOf(defLine);
    const parts: string[] = [];
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^Does the property generally conform/i.test(lines[i].fullText)) break;
      parts.push(lines[i].fullText.trim());
    }
    physicalDeficiencies = parts.join(" ").trim();
  }

  // Conformity
  const confLine = findLine(lines, /^Does the property generally conform/i);
  let conformity = "";
  if (confLine) {
    const idx = lines.indexOf(confLine);
    const parts: string[] = [];
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^Freddie Mac Form|^Form 1004UAD/i.test(lines[i].fullText)) break;
      parts.push(lines[i].fullText.trim());
    }
    conformity = parts.join(" ").trim();
  }

  const type = findLine(lines, /^Type/i, { minY: 640, maxY: 660 });
  let typeStr = "";
  if (type) {
    const detSeg = type.segments.find((s) => /^Det\./i.test(s.text.trim()));
    if (detSeg) typeStr = "Detached";
    const attSeg = type.segments.find((s) => /^Att\./i.test(s.text.trim()));
    if (attSeg) typeStr = "Attached";
  }

  return {
    stories, type: typeStr, designStyle, yearBuilt, effectiveAge,
    foundationWalls, exteriorWalls, roofSurface, guttersDownspouts, windowType,
    floors, walls, trimFinish, bathFloor, bathWainscot,
    heatingType, heatingFuel, coolingType,
    fireplaces, patioOrDeck, pool, fence, porch,
    drivewayCarCount, drivewaySurface, garageCarCount, carportCarCount,
    roomCount, bedrooms, baths, grossLivingArea,
    additionalFeatures, conditionDescription, physicalDeficiencies, conformity,
    boundingBoxes: bb,
  };
}
