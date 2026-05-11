import { toBBox } from "@parseo/shared";
import type { TextLine, BoundingBox, FilledRect } from "@parseo/shared";
import type {
  SubjectSection,
  ContractSection,
  NeighborhoodSection,
  ProjectSiteSection,
  ProjectInfoSection,
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

function findLine(
  lines: TextLine[],
  pattern: RegExp,
  opts?: { minY?: number; maxY?: number },
): TextLine | undefined {
  return lines.find((l) => {
    if (opts?.minY !== undefined && l.y < opts.minY) return false;
    if (opts?.maxY !== undefined && l.y > opts.maxY) return false;
    return pattern.test(l.fullText);
  });
}

// ── Subject ──────────────────────────────────────────────────────────────

export function parseSubjectSection(lines: TextLine[]): SubjectSection {
  const bb: Record<string, BoundingBox> = {};

  const addrLine = findLine(lines, /^Property Address/i);
  let propertyAddress = "", unitNumber = "", city = "", state = "", zipCode = "";
  if (addrLine) {
    for (const seg of addrLine.segments) {
      const t = seg.text.trim();
      if (/^Property Address\s/i.test(t)) { propertyAddress = extractAfterLabel(seg, /^Property Address\s+/i); bb.propertyAddress = toBBox(seg, addrLine); }
      else if (/^Unit #\s/i.test(t)) { unitNumber = extractAfterLabel(seg, /^Unit #\s+/i); bb.unitNumber = toBBox(seg, addrLine); }
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
      else if (/Owner of Public Record/i.test(t)) {
        let raw = extractAfterLabel(seg, /^Owner of Public Record\s*/i);
        // County may be concatenated at the end (e.g. "...TrustCounty Palm Beach")
        const countyMatch = raw.match(/County\s+(.+)$/i);
        if (countyMatch) {
          county = countyMatch[1].trim();
          raw = raw.slice(0, countyMatch.index).trim();
        }
        ownerOfPublicRecord = raw;
        bb.ownerOfPublicRecord = toBBox(seg, borrowerLine);
      }
      else if (/^County\s/i.test(t)) { county = extractAfterLabel(seg, /^County\s+/i); bb.county = toBBox(seg, borrowerLine); }
    }
  }

  const legalLine = findLine(lines, /^Legal Description\s/i);
  const legalDescription = legalLine ? extractAfterLabel(legalLine.segments[0] ?? { text: "" }, /^Legal Description\s+/i) : "";
  if (legalLine?.segments[0]) bb.legalDescription = toBBox(legalLine.segments[0], legalLine);

  const apnLine = findLine(lines, /^Assessor's Parcel #/i);
  let assessorParcelNumber = "", taxYear: number | null = null, realEstateTaxes: number | null = null;
  if (apnLine) {
    for (const seg of apnLine.segments) {
      const t = seg.text.trim();
      if (/^Assessor's Parcel #/i.test(t)) { assessorParcelNumber = extractAfterLabel(seg, /^Assessor's Parcel #\s*/i); bb.assessorParcelNumber = toBBox(seg, apnLine); }
      else if (/^Tax Year/i.test(t)) { taxYear = parseNum(extractAfterLabel(seg, /^Tax Year\s*/i)); }
      else if (/^R\.?E\.?\s*Taxes\s*\$/i.test(t)) { realEstateTaxes = parseNum(extractAfterLabel(seg, /^R\.?E\.?\s*Taxes\s*\$\s*/i)); bb.realEstateTaxes = toBBox(seg, apnLine); }
    }
  }

  const projLine = findLine(lines, /^Project Name\s/i);
  let projectName = "", phase = "", mapReference = "", censusTract = "";
  if (projLine) {
    for (const seg of projLine.segments) {
      const t = seg.text.trim();
      if (/^Project Name\s/i.test(t)) { projectName = extractAfterLabel(seg, /^Project Name\s+/i); bb.projectName = toBBox(seg, projLine); }
      else if (/^Phase #\s/i.test(t)) { phase = extractAfterLabel(seg, /^Phase #\s+/i); }
      else if (/^Map Reference/i.test(t)) { mapReference = extractAfterLabel(seg, /^Map Reference\s+/i); }
      else if (/^Census Tract/i.test(t)) { censusTract = extractAfterLabel(seg, /^Census Tract\s+/i); }
    }
  }

  const occLine = findLine(lines, /^Occupant/i);
  let occupant = "", specialAssessments: number | null = null, hoaAmount: number | null = null, hoaPeriod = "";
  if (occLine) {
    for (const seg of occLine.segments) {
      const t = seg.text.trim();
      if (/^Special Assessments\s*\$/i.test(t)) specialAssessments = parseNum(extractAfterLabel(seg, /^Special Assessments\s*\$\s*/i));
      else if (/^HOA\s*\$/i.test(t)) { hoaAmount = parseNum(extractAfterLabel(seg, /^HOA\s*\$\s*/i)); bb.hoaAmount = toBBox(seg, occLine); }
      else if (/^per (year|month)/i.test(t)) hoaPeriod = t;
    }
  }

  const prLine = findLine(lines, /^Property Rights Appraised/i);
  let propertyRightsAppraised = "";
  if (prLine) {
    const idx = prLine.segments.findIndex((s) => /^Property Rights Appraised/i.test(s.text.trim()));
    if (idx >= 0 && prLine.segments[idx + 1]) propertyRightsAppraised = prLine.segments[idx + 1].text.trim();
  }

  const assignLine = findLine(lines, /Assignment Type/i);
  let assignmentType = "";
  if (assignLine) {
    const atIdx = assignLine.segments.findIndex((s) => /Assignment Type/i.test(s.text));
    if (atIdx >= 0 && assignLine.segments[atIdx + 1]) assignmentType = assignLine.segments[atIdx + 1].text.trim();
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
    propertyAddress, unitNumber, city, state, zipCode, borrower, ownerOfPublicRecord, county,
    legalDescription, assessorParcelNumber, taxYear, realEstateTaxes,
    projectName, phase, mapReference, censusTract, occupant, specialAssessments,
    hoaAmount, hoaPeriod, propertyRightsAppraised, assignmentType, lenderClient, lenderAddress,
    boundingBoxes: bb,
  };
}

// ── Contract ─────────────────────────────────────────────────────────────

export function parseContractSection(lines: TextLine[]): ContractSection {
  const bb: Record<string, BoundingBox> = {};

  const offeredLine = findLine(lines, /currently offered for sale/i);
  const isOfferedForSale = offeredLine?.fullText.includes("Yes") && !offeredLine?.fullText.includes("No") ? "Yes" : offeredLine?.fullText.includes("No") ? "No" : "";

  const dataSourceLine = findLine(lines, /^Report data source/i);
  let reportDataSources = "";
  if (dataSourceLine) {
    const valueSeg = dataSourceLine.segments.find((s) => s.x > 180);
    if (valueSeg) { reportDataSources = valueSeg.text.trim(); bb.reportDataSources = toBBox(valueSeg, dataSourceLine); }
    // May continue on next line
    const idx = lines.indexOf(dataSourceLine);
    if (idx >= 0) {
      for (let i = idx + 1; i < lines.length; i++) {
        if (/^I\s+(did|did not)/i.test(lines[i].fullText) || /^Contract Price/i.test(lines[i].fullText)) break;
        reportDataSources += " " + lines[i].fullText.trim();
      }
      reportDataSources = reportDataSources.trim();
    }
  }

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

  const assistLine = findLine(lines, /If Yes, report the total dollar/i);
  let financialAssistance = "";
  if (assistLine) {
    const valueSeg = assistLine.segments.find((s) => /^\$/.test(s.text.trim()));
    if (valueSeg) financialAssistance = valueSeg.text.trim();
  }

  return { isOfferedForSale, reportDataSources, contractAnalysis, contractPrice, dateOfContract, financialAssistance, boundingBoxes: bb };
}

// ── Neighborhood ─────────────────────────────────────────────────────────

/**
 * Detect which checkbox option is selected in a row by finding a filled rect
 * positioned just before one of the option labels.
 *
 * Checkbox layout: each row has 3 options at fixed x positions.
 * A filled ~7x7 rect appears ~12px before the selected option's text.
 */
function detectCheckboxSelection(
  rects: FilledRect[],
  rowY: number,
  options: { label: string; textX: number }[],
  yTolerance = 8,
): string {
  // Find rects in this row
  const rowRects = rects.filter((r) => Math.abs(r.y - rowY) < yTolerance);
  for (const rect of rowRects) {
    // The checkbox rect appears ~12px before the option text x position
    for (const opt of options) {
      if (rect.x > opt.textX - 20 && rect.x < opt.textX - 2) {
        return opt.label;
      }
    }
  }
  return "";
}

export function parseNeighborhoodSection(lines: TextLine[], checkboxRects?: FilledRect[]): NeighborhoodSection {
  const bb: Record<string, BoundingBox> = {};
  let location = "", builtUp = "", growth = "";
  let propertyValues = "", demandSupply = "", marketingTime = "";

  // Detect checkbox selections from filled rects
  if (checkboxRects && checkboxRects.length > 0) {
    // Find the row y-coordinates from the text lines
    const locationLine = findLine(lines, /^Location/i);
    const builtUpLine = findLine(lines, /^Built-Up/i);
    const growthLine2 = findLine(lines, /^Growth/i);

    if (locationLine) {
      location = detectCheckboxSelection(checkboxRects, locationLine.y, [
        { label: "Urban", textX: 58 },
        { label: "Suburban", textX: 105 },
        { label: "Rural", textX: 155 },
      ]);
      propertyValues = detectCheckboxSelection(checkboxRects, locationLine.y, [
        { label: "Increasing", textX: 259 },
        { label: "Stable", textX: 317 },
        { label: "Declining", textX: 367 },
      ]);
    }
    if (builtUpLine) {
      builtUp = detectCheckboxSelection(checkboxRects, builtUpLine.y, [
        { label: "Over 75%", textX: 58 },
        { label: "25-75%", textX: 105 },
        { label: "Under 25%", textX: 155 },
      ]);
      demandSupply = detectCheckboxSelection(checkboxRects, builtUpLine.y, [
        { label: "Shortage", textX: 259 },
        { label: "In Balance", textX: 317 },
        { label: "Over Supply", textX: 367 },
      ]);
    }
    if (growthLine2) {
      growth = detectCheckboxSelection(checkboxRects, growthLine2.y, [
        { label: "Rapid", textX: 58 },
        { label: "Stable", textX: 105 },
        { label: "Slow", textX: 155 },
      ]);
      marketingTime = detectCheckboxSelection(checkboxRects, growthLine2.y, [
        { label: "Under 3 mths", textX: 259 },
        { label: "3-6 mths", textX: 317 },
        { label: "Over 6 mths", textX: 367 },
      ]);
    }
  }
  let priceLow: number | null = null, priceHigh: number | null = null, pricePredominant: number | null = null;
  let ageLow: number | null = null, ageHigh: number | null = null, agePredominant: number | null = null;

  // Price/Age from the grid lines — values are in $(000) and (yrs) columns.
  // The price and age values may be embedded within larger text segments
  // (e.g. "Over 6 mths 415 Low", "1,250 High", "550 Pred. 36 Other").
  // We look for segments in the x~360-470 range and parse numbers + labels.

  const growthLine = findLine(lines, /^Growth/i);
  const boundaryLine = findLine(lines, /^Neighborhood Boundaries/i);

  // Extract price/age from a line by looking for patterns like "415 Low", "1,250 High", "550 Pred."
  function extractPriceAge(line: TextLine | undefined): { price: number | null; age: number | null; priceSeg?: typeof line extends undefined ? never : { seg: any; line: TextLine }; ageSeg?: { seg: any; line: TextLine } } {
    if (!line) return { price: null, age: null };
    let price: number | null = null, age: number | null = null;
    let priceSeg: { seg: any; line: TextLine } | undefined;
    let ageSeg: { seg: any; line: TextLine } | undefined;
    for (const seg of line.segments) {
      if (seg.x < 350) continue;
      const t = seg.text.trim();
      // Pattern: "number Low/High/Pred" for price (x ~360-420)
      const priceMatch = t.match(/([\d,]+)\s*(Low|High|Pred\.?)/i);
      if (priceMatch && seg.x < 470) {
        price = parseNum(priceMatch[1]);
        priceSeg = { seg, line };
      }
      // Pattern: standalone number for age (x >= 460) or "number label" where label is text
      const ageMatch = t.match(/^(\d+)\s*$/);
      if (ageMatch && seg.x >= 460) {
        age = parseNum(ageMatch[1]);
        ageSeg = { seg, line };
      }
      // Combined pattern: "550 Pred. 36 Other" — price then age
      const combinedMatch = t.match(/([\d,]+)\s+Pred\.?\s+(\d+)/i);
      if (combinedMatch) {
        price = parseNum(combinedMatch[1]);
        age = parseNum(combinedMatch[2]);
        priceSeg = { seg, line };
        ageSeg = { seg, line };
      }
      // Pattern: "45 Commercial" or "45 Other" where the number is the age
      if (!age) {
        const ageLabelMatch = t.match(/^(\d+)\s+(Commercial|Other|Multi|One)/i);
        if (ageLabelMatch && seg.x >= 460) {
          age = parseNum(ageLabelMatch[1]);
          ageSeg = { seg, line };
        }
      }
    }
    return { price, age, priceSeg, ageSeg };
  }

  // Low line (Growth row)
  const lowResult = extractPriceAge(growthLine);
  priceLow = lowResult.price;
  ageLow = lowResult.age;
  if (lowResult.priceSeg) bb.priceLow = toBBox(lowResult.priceSeg.seg, lowResult.priceSeg.line);
  if (lowResult.ageSeg) bb.ageLow = toBBox(lowResult.ageSeg.seg, lowResult.ageSeg.line);

  // High line (Neighborhood Boundaries row)
  const highResult = extractPriceAge(boundaryLine);
  priceHigh = highResult.price;
  ageHigh = highResult.age;
  if (highResult.priceSeg) bb.priceHigh = toBBox(highResult.priceSeg.seg, highResult.priceSeg.line);
  if (highResult.ageSeg) bb.ageHigh = toBBox(highResult.ageSeg.seg, highResult.ageSeg.line);

  // Predominant line (the line after boundaries that has "Pred")
  const predLine = lines.find((l) => l.y > (boundaryLine?.y ?? growthLine?.y ?? 0) && /Pred\.?/i.test(l.fullText));
  const predResult = extractPriceAge(predLine);
  pricePredominant = predResult.price;
  agePredominant = predResult.age;
  if (predResult.priceSeg) bb.pricePredominant = toBBox(predResult.priceSeg.seg, predResult.priceSeg.line);
  if (predResult.ageSeg) bb.agePredominant = toBBox(predResult.ageSeg.seg, predResult.ageSeg.line);

  // Land use percentages
  let landUseOneUnit: number | null = null, landUseTwoFourUnit: number | null = null;
  let landUseMultiFamily: number | null = null, landUseCommercial: number | null = null, landUseOther: number | null = null;
  for (const l of lines) {
    if (l.y < 310 || l.y > 370) continue;
    for (const seg of l.segments) {
      if (seg.x < 540) continue;
      const pct = seg.text.match(/(\d+)\s*%/);
      if (!pct) continue;
      const val = parseNum(pct[1]);
      if (/One-Unit/i.test(l.fullText)) { landUseOneUnit = val; break; }
      if (/2-4 Unit/i.test(l.fullText)) { landUseTwoFourUnit = val; break; }
      if (/Multi/i.test(l.fullText)) { landUseMultiFamily = val; break; }
      if (/Commercial/i.test(l.fullText)) { landUseCommercial = val; break; }
      if (/Other/i.test(l.fullText) && !/Other \(describe\)/i.test(l.fullText)) { landUseOther = val; break; }
    }
  }

  // Boundaries
  let boundaries = "";
  if (boundaryLine) {
    const valueSeg = boundaryLine.segments.find((s) => s.x > 100 && s.x < 410);
    if (valueSeg) { boundaries = valueSeg.text.trim(); bb.boundaries = toBBox(valueSeg, boundaryLine); }
    const idx = lines.indexOf(boundaryLine);
    if (idx >= 0 && lines[idx + 1] && lines[idx + 1].y < boundaryLine.y + 20) {
      const nextSeg = lines[idx + 1].segments.find((s) => s.x < 410);
      if (nextSeg) boundaries += " " + nextSeg.text.trim();
    }
  }

  // Description
  const descLine = findLine(lines, /^Neighborhood Description/i);
  let description = "";
  if (descLine) {
    const valueSeg = descLine.segments.find((s) => s.x > 100);
    if (valueSeg) { description = valueSeg.text.trim(); bb.description = toBBox(valueSeg, descLine); }
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
      if (/^Topography|^Specific Zoning/i.test(lines[i].fullText)) break;
      parts.push(lines[i].fullText.trim());
    }
    marketConditions = parts.join(" ").trim();
  }

  return {
    location, builtUp, growth, propertyValues, demandSupply, marketingTime,
    priceLow, priceHigh, pricePredominant, ageLow, ageHigh, agePredominant,
    landUseOneUnit, landUseTwoFourUnit, landUseMultiFamily, landUseCommercial, landUseOther,
    boundaries, description, marketConditions, boundingBoxes: bb,
  };
}

// ── Project Site ─────────────────────────────────────────────────────────

export function parseProjectSiteSection(lines: TextLine[]): ProjectSiteSection {
  const bb: Record<string, BoundingBox> = {};

  const topoLine = findLine(lines, /^Topography/i);
  let topography = "", size = "", density = "", view = "";
  if (topoLine) {
    for (const seg of topoLine.segments) {
      const t = seg.text.trim();
      if (/^Topography\s/i.test(t)) { topography = extractAfterLabel(seg, /^Topography\s+/i); bb.topography = toBBox(seg, topoLine); }
      else if (/^Size\s/i.test(t)) { size = extractAfterLabel(seg, /^Size\s+/i); }
      else if (/^Density\s/i.test(t)) { density = extractAfterLabel(seg, /^Density\s+/i); }
      else if (/^View\s/i.test(t)) { view = extractAfterLabel(seg, /^View\s+/i); bb.view = toBBox(seg, topoLine); }
    }
  }

  const zonLine = findLine(lines, /^Specific Zoning Classification/i);
  let zoningClassification = "", zoningDescription = "";
  if (zonLine) {
    for (const seg of zonLine.segments) {
      const t = seg.text.trim();
      if (/^Specific Zoning Classification/i.test(t)) zoningClassification = extractAfterLabel(seg, /^Specific Zoning Classification\s+/i);
      else if (/^Zoning Description/i.test(t)) zoningDescription = extractAfterLabel(seg, /^Zoning Description\s+/i);
    }
  }

  const compLine = findLine(lines, /^Zoning Compliance/i);
  let zoningCompliance = "";
  if (compLine) {
    const idx = compLine.segments.findIndex((s) => /^Zoning Compliance/i.test(s.text.trim()));
    if (idx >= 0 && compLine.segments[idx + 1]) zoningCompliance = compLine.segments[idx + 1].text.trim();
  }

  const hbuLine = findLine(lines, /highest and best use/i);
  let highestAndBestUse = "";
  if (hbuLine) {
    if (/\bYes\b/.test(hbuLine.fullText)) highestAndBestUse = "Yes";
    else if (/\bNo\b/.test(hbuLine.fullText)) highestAndBestUse = "No";
  }

  const femaLine = findLine(lines, /FEMA Special Flood/i);
  let femaFloodZone = "", femaMapNumber = "", femaMapDate = "";
  if (femaLine) {
    for (const seg of femaLine.segments) {
      const t = seg.text.trim();
      if (/FEMA Flood Zone\s/i.test(t)) femaFloodZone = extractAfterLabel(seg, /.*?FEMA Flood Zone\s+/i);
      else if (/FEMA Map #\s/i.test(t)) { femaMapNumber = extractAfterLabel(seg, /^FEMA Map #\s+/i); bb.femaMapNumber = toBBox(seg, femaLine); }
      else if (/FEMA Map Date\s/i.test(t)) { femaMapDate = extractAfterLabel(seg, /^FEMA Map Date\s+/i); }
    }
  }

  const adverseLine = findLine(lines, /adverse site conditions/i);
  let adverseConditions = "";
  if (adverseLine) {
    const idx = lines.indexOf(adverseLine);
    const parts: string[] = [];
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^Data source\(s\) for project/i.test(lines[i].fullText)) break;
      const txt = lines[i].fullText.trim();
      if (txt) parts.push(txt);
    }
    adverseConditions = parts.join(" ").trim();
  }

  return { topography, size, density, view, zoningClassification, zoningDescription, zoningCompliance, highestAndBestUse, femaFloodZone, femaMapNumber, femaMapDate, adverseConditions, boundingBoxes: bb };
}

// ── Project Information ──────────────────────────────────────────────────

export function parseProjectInfoSection(lines: TextLine[]): ProjectInfoSection {
  const bb: Record<string, BoundingBox> = {};

  const dsLine = findLine(lines, /^Data source\(s\) for project information/i);
  let dataSourcesForProjectInfo = "";
  if (dsLine) {
    const valueSeg = dsLine.segments.find((s) => s.x > 130);
    if (valueSeg) dataSourcesForProjectInfo = valueSeg.text.trim();
  }

  const projDescLine = findLine(lines, /^Project Description/i);
  let projectDescription = "";
  if (projDescLine) {
    // Last segment is usually the selected description type
    const lastSeg = projDescLine.segments[projDescLine.segments.length - 1];
    if (lastSeg && !/^Project Description/i.test(lastSeg.text)) {
      const m = lastSeg.text.match(/Other \(describe\)\s*(.*)/i);
      projectDescription = m ? m[1].trim() : lastSeg.text.replace(/^Other \(describe\)\s*/i, "").trim();
      bb.projectDescription = toBBox(lastSeg, projDescLine);
    }
  }

  const storiesLine = findLine(lines, /^# of Stories/i);
  let numberOfStories: number | null = null, exteriorWalls = "";
  if (storiesLine) {
    for (const seg of storiesLine.segments) {
      const t = seg.text.trim();
      if (/^# of Stories\s/i.test(t)) numberOfStories = parseNum(extractAfterLabel(seg, /^# of Stories\s+/i));
      else if (/^Exterior Walls$/i.test(t)) {
        const next = storiesLine.segments[storiesLine.segments.indexOf(seg) + 1];
        if (next) exteriorWalls = next.text.trim();
      }
    }
  }

  const elevLine = findLine(lines, /^# of Elevators/i);
  let numberOfElevators: number | null = null, roofSurface = "";
  if (elevLine) {
    for (const seg of elevLine.segments) {
      const t = seg.text.trim();
      if (/^# of Elevators\s/i.test(t)) numberOfElevators = parseNum(extractAfterLabel(seg, /^# of Elevators\s+/i));
      else if (/^Roof Surface$/i.test(t)) {
        const next = elevLine.segments[elevLine.segments.indexOf(seg) + 1];
        if (next) roofSurface = next.text.trim();
      }
    }
  }

  const existLine = findLine(lines, /^Existing|^Under Construction/i, { minY: 660 });
  let existingOrProposed = "";
  if (existLine) {
    if (/Existing/.test(existLine.fullText)) existingOrProposed = "Existing";
    else if (/Proposed/.test(existLine.fullText)) existingOrProposed = "Proposed";
    else if (/Under Construction/.test(existLine.fullText)) existingOrProposed = "Under Construction";
  }

  const parkLine = findLine(lines, /^Total # Parking/i) ?? findLine(lines, /Total # Parking/i);
  let totalParking: number | null = null, parkingRatio = "";
  if (parkLine) {
    for (const seg of parkLine.segments) {
      if (/^Total # Parking/i.test(seg.text)) {
        const next = parkLine.segments[parkLine.segments.indexOf(seg) + 1];
        if (next) totalParking = parseNum(next.text);
      }
    }
  }
  const ratioLine = findLine(lines, /Ratio \(spaces\/units\)/i);
  if (ratioLine) {
    for (const seg of ratioLine.segments) {
      if (/Ratio \(spaces\/units\)/i.test(seg.text)) parkingRatio = extractAfterLabel(seg, /^Ratio \(spaces\/units\)\s*/i);
    }
  }

  const yrLine = findLine(lines, /^Year Built/i, { minY: 680 });
  let yearBuilt: number | null = null, parkingType = "";
  if (yrLine) {
    for (const seg of yrLine.segments) {
      if (/^Year Built/i.test(seg.text)) {
        const next = yrLine.segments[yrLine.segments.indexOf(seg) + 1];
        if (next) { yearBuilt = parseNum(next.text); bb.yearBuilt = toBBox(next, yrLine); }
      }
      else if (/^Type/i.test(seg.text)) {
        const next = yrLine.segments[yrLine.segments.indexOf(seg) + 1];
        if (next) parkingType = next.text.trim();
      }
    }
  }

  const effLine = findLine(lines, /^Effective Age/i, { minY: 690 });
  let effectiveAge: number | null = null, guestParking: number | null = null;
  if (effLine) {
    for (const seg of effLine.segments) {
      if (/^Effective Age\s/i.test(seg.text)) effectiveAge = parseNum(extractAfterLabel(seg, /^Effective Age\s+/i));
      else if (/^Guest Parking\s/i.test(seg.text)) guestParking = parseNum(extractAfterLabel(seg, /^Guest Parking\s+/i));
    }
  }

  // Unit counts from the grid
  function getUnitCount(label: RegExp): number | null {
    for (const l of lines) {
      if (!label.test(l.fullText)) continue;
      for (const seg of l.segments) {
        if (label.test(seg.text)) continue;
        if (seg.x >= 200 && seg.x < 320) {
          const m = seg.text.match(/^(\d+)/);
          if (m) return parseNum(m[1]);
        }
      }
    }
    return null;
  }

  const numberOfUnits = getUnitCount(/# of Units\b(?! (Completed|For Sale|Sold|Rented))/i);
  const numberOfPhases = getUnitCount(/# of Phases\b/i);
  const unitsForSale = getUnitCount(/# of Units For Sale/i);
  const unitsSold = getUnitCount(/# of Units Sold/i);
  const unitsRented = getUnitCount(/# of Units Rented/i);
  const ownerOccupiedUnits = getUnitCount(/# of Owner Occupied/i);

  const occLine = findLine(lines, /^Project Primary Occupancy/i);
  let projectPrimaryOccupancy = "";
  if (occLine) {
    const idx = occLine.segments.findIndex((s) => /^Project Primary Occupancy/i.test(s.text));
    if (idx >= 0 && occLine.segments[idx + 1]) projectPrimaryOccupancy = occLine.segments[idx + 1].text.trim();
  }

  const hoaLine = findLine(lines, /developer\/builder in control.*HOA/i);
  const hoaControl = hoaLine?.fullText.includes("Yes") ? "Yes" : hoaLine?.fullText.includes("No") ? "No" : "";

  const mgmtLine = findLine(lines, /^Management Group/i);
  let managementGroup = "";
  if (mgmtLine) {
    const idx = mgmtLine.segments.findIndex((s) => /^Management Group/i.test(s.text));
    if (idx >= 0 && mgmtLine.segments[idx + 1]) managementGroup = mgmtLine.segments[idx + 1].text.trim();
  }

  const entityLine = findLine(lines, /single entity.*own more than 10%/i);
  const singleEntityOwnership = entityLine?.fullText.includes("Yes") ? "Yes" : entityLine?.fullText.includes("No") ? "No" : "";

  const convLine = findLine(lines, /conversion of existing building/i);
  const conversionFromExisting = convLine?.fullText.includes("Yes") ? "Yes" : convLine?.fullText.includes("No") ? "No" : "";

  const completeLine = findLine(lines, /units, common elements.*complete/i);
  const unitsComplete = completeLine?.fullText.includes("Yes") ? "Yes" : completeLine?.fullText.includes("No") ? "No" : "";

  const commLine = findLine(lines, /commercial space in the project/i);
  const commercialSpace = commLine?.fullText.includes("Yes") ? "Yes" : commLine?.fullText.includes("No") ? "No" : "";

  return {
    dataSourcesForProjectInfo, projectDescription, numberOfStories, exteriorWalls,
    numberOfElevators, roofSurface, existingOrProposed, totalParking, parkingRatio,
    yearBuilt, parkingType, effectiveAge, guestParking,
    numberOfUnits, numberOfPhases, unitsForSale, unitsSold, unitsRented, ownerOccupiedUnits,
    projectPrimaryOccupancy, hoaControl, managementGroup, singleEntityOwnership,
    conversionFromExisting, unitsComplete, commercialSpace,
    boundingBoxes: bb,
  };
}
