import { toBBox } from "@parseo/shared";
import type { TextLine, BoundingBox } from "@parseo/shared";
import type {
  ProjectAnalysisSection,
  UnitDescriptionSection,
  PriorSaleHistorySection,
  PriorSaleEntry,
} from "./types.js";

// ── Utilities ────────────────────────────────────────────────────────────

function parseNum(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,%]/g, "").replace(/,/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
}

function parseCurrency(raw: string): number | null {
  const match = raw.match(/\$?\s*([\d,]+(?:\.\d+)?)/);
  return match ? parseNum(match[1]) : null;
}

function extractAfterLabel(seg: { text: string }, label: RegExp): string {
  return seg.text.replace(label, "").trim();
}

function findLine(lines: TextLine[], pattern: RegExp): TextLine | undefined {
  return lines.find((l) => pattern.test(l.fullText));
}

function collectText(lines: TextLine[], startIdx: number, endPattern: RegExp): string {
  const parts: string[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    if (endPattern.test(lines[i].fullText)) break;
    const t = lines[i].fullText.trim();
    if (t) parts.push(t);
  }
  return parts.join(" ").trim();
}

// ── Project Analysis (Page 2 top) ────────────────────────────────────────

export function parseProjectAnalysisSection(lines: TextLine[]): ProjectAnalysisSection {
  const bb: Record<string, BoundingBox> = {};

  // Condition and quality
  const condLine = findLine(lines, /condition of the project and quality/i);
  let conditionAndQuality = "";
  if (condLine) {
    const idx = lines.indexOf(condLine);
    const valueSeg = condLine.segments.find((s) => s.x > 300);
    const parts: string[] = [];
    if (valueSeg) parts.push(valueSeg.text.trim());
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^Describe the common elements/i.test(lines[i].fullText)) break;
      const t = lines[i].fullText.trim();
      if (t) parts.push(t);
    }
    conditionAndQuality = parts.join(" ").trim();
    bb.conditionAndQuality = toBBox(condLine.segments[0], condLine);
  }

  // Common elements
  const commLine = findLine(lines, /common elements and recreational/i);
  let commonElements = "";
  if (commLine) {
    const valueSeg = commLine.segments.find((s) => s.x > 280);
    if (valueSeg) { commonElements = valueSeg.text.trim(); bb.commonElements = toBBox(valueSeg, commLine); }
  }

  // Common elements leased
  const leasedLine = findLine(lines, /common elements leased/i);
  const commonElementsLeased = leasedLine?.fullText.includes("Yes") ? "Yes" : leasedLine?.fullText.includes("No") ? "No" : "";

  // Ground rent
  const groundLine = findLine(lines, /subject to a ground rent/i);
  const groundRent = groundLine?.fullText.includes("Yes") ? "Yes" : groundLine?.fullText.includes("No") ? "No" : "";

  // Parking adequacy
  const parkLine = findLine(lines, /parking facilities adequate/i);
  const parkingAdequacy = parkLine?.fullText.includes("Yes") ? "Yes" : parkLine?.fullText.includes("No") ? "No" : "";

  // Budget analysis
  const budgetLine = findLine(lines, /analyze the condominium project budget/i);
  let budgetAnalysis = "";
  if (budgetLine) {
    const idx = lines.indexOf(budgetLine);
    const parts: string[] = [];
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^Are there any other fees/i.test(lines[i].fullText)) break;
      const t = lines[i].fullText.trim();
      if (t) parts.push(t);
    }
    budgetAnalysis = parts.join(" ").trim();
  }

  // Other fees
  const feeLine = findLine(lines, /other fees.*for the use of/i);
  const otherFees = feeLine?.fullText.includes("Yes") ? "Yes" : feeLine?.fullText.includes("No") ? "No" : "";

  // Unit charge comparison
  const compLine = findLine(lines, /subject unit charge appears/i);
  let unitChargeComparison = "";
  if (compLine) {
    if (/\bHigh\b/.test(compLine.fullText)) unitChargeComparison = "High";
    else if (/\bAverage\b/.test(compLine.fullText)) unitChargeComparison = "Average";
    else if (/\bLow\b/.test(compLine.fullText)) unitChargeComparison = "Low";
  }

  // Special characteristics
  const specLine = findLine(lines, /special or unusual characteristics/i);
  let specialCharacteristics = "";
  if (specLine) {
    const idx = lines.indexOf(specLine);
    const parts: string[] = [];
    // Check next line(s)
    if (lines[idx + 1]) {
      const valueSeg = lines[idx + 1].segments.find((s) => s.x > 280);
      if (valueSeg) parts.push(valueSeg.text.trim());
    }
    for (let i = idx + 2; i < lines.length; i++) {
      if (/^Unit Charge/i.test(lines[i].fullText)) break;
      const t = lines[i].fullText.trim();
      if (t) parts.push(t);
    }
    specialCharacteristics = parts.join(" ").trim();
  }

  // Unit charge
  const chargeLine = findLine(lines, /^Unit Charge \$/i);
  let unitChargeMonthly: number | null = null, unitChargeAnnual: number | null = null, assessmentPerSqft: number | null = null;
  if (chargeLine) {
    for (const seg of chargeLine.segments) {
      const t = seg.text.trim();
      if (/^Unit Charge \$\s/i.test(t)) { unitChargeMonthly = parseNum(extractAfterLabel(seg, /^Unit Charge \$\s*/i)); bb.unitChargeMonthly = toBBox(seg, chargeLine); }
      const annualMatch = t.match(/\$\s*([\d,.]+)\s*per year/i);
      if (annualMatch) unitChargeAnnual = parseNum(annualMatch[1]);
      const sqftMatch = t.match(/=\s*\$\s*([\d,.]+)/i);
      if (sqftMatch) assessmentPerSqft = parseNum(sqftMatch[1]);
    }
  }

  // Utilities included
  const utilLine = findLine(lines, /Utilities included in the unit/i);
  let utilitiesIncluded = "";
  if (utilLine) {
    // All labels after "None" or specific utility names
    const segs = utilLine.segments.filter((s) => s.x > 200);
    utilitiesIncluded = segs.map((s) => s.text.trim()).join(", ");
  }

  return {
    conditionAndQuality, commonElements, commonElementsLeased, groundRent,
    parkingAdequacy, budgetAnalysis, otherFees, unitChargeComparison, specialCharacteristics,
    unitChargeMonthly, unitChargeAnnual, assessmentPerSqft, utilitiesIncluded,
    boundingBoxes: bb,
  };
}

// ── Unit Description (Page 2) ────────────────────────────────────────────

export function parseUnitDescriptionSection(lines: TextLine[]): UnitDescriptionSection {
  const bb: Record<string, BoundingBox> = {};

  const floorLine = findLine(lines, /^Floor #/i);
  let floorNumber = "";
  if (floorLine) {
    const seg = floorLine.segments.find((s) => /^Floor #/i.test(s.text));
    if (seg) floorNumber = extractAfterLabel(seg, /^Floor #\s*/i);
  }

  const levelsLine = findLine(lines, /^# of Levels/i);
  let numberOfLevels: number | null = null;
  if (levelsLine) {
    const seg = levelsLine.segments.find((s) => /^# of Levels/i.test(s.text));
    if (seg) numberOfLevels = parseNum(extractAfterLabel(seg, /^# of Levels\s+/i));
  }

  const heatLine = findLine(lines, /^Heating Type/i);
  let heatingType = "", heatingFuel = "";
  if (heatLine) {
    for (const seg of heatLine.segments) {
      const t = seg.text.trim();
      if (/^Heating Type\s/i.test(t)) heatingType = extractAfterLabel(seg, /^Heating Type\s+/i);
      else if (/^Fuel\s/i.test(t)) heatingFuel = extractAfterLabel(seg, /^Fuel\s+/i);
    }
  }

  const acLine = findLine(lines, /^Central AC/i);
  let centralAC = "";
  if (acLine) {
    const seg = acLine.segments.find((s) => /^Central AC/i.test(s.text) || /^Individual AC/i.test(s.text));
    if (seg) centralAC = /Central AC/i.test(seg.text) ? "Central" : "Individual";
  }

  // Interior materials
  function findMaterial(label: RegExp): string {
    for (const l of lines) {
      if (l.y < 415 || l.y > 500) continue;
      for (const seg of l.segments) {
        if (label.test(seg.text)) {
          const val = seg.text.replace(label, "").trim();
          if (val) return val;
          const next = l.segments[l.segments.indexOf(seg) + 1];
          if (next) return next.text.trim();
        }
      }
    }
    return "";
  }

  const floors = findMaterial(/^Floors\s+/i);
  const walls = findMaterial(/^Walls\s+/i);
  const trimFinish = findMaterial(/^Trim\/Finish\s+/i);
  const bathWainscot = findMaterial(/^Bath Wainscot\s+/i);
  const doors = findMaterial(/^Doors\s+/i);

  // Amenities
  let fireplaces: number | null = null, deckPatio = "", porchBalcony = "";
  for (const l of lines) {
    if (l.y < 415 || l.y > 500) continue;
    for (const seg of l.segments) {
      const t = seg.text.trim();
      if (/^Fireplace\(s\) #/i.test(t)) fireplaces = parseNum(extractAfterLabel(seg, /^Fireplace\(s\) #\s*/i));
      else if (/^Deck\/Patio/i.test(t)) deckPatio = extractAfterLabel(seg, /^Deck\/Patio\s*/i);
      else if (/^Porch\/Balcony/i.test(t)) porchBalcony = extractAfterLabel(seg, /^Porch\/Balcony\s*/i);
    }
  }

  // Appliances
  let refrigerator = "", rangeOven = "", disposal = "", dishwasher = "", microwave = "", washerDryer = "";
  for (const l of lines) {
    if (l.y < 415 || l.y > 500) continue;
    for (const seg of l.segments) {
      const t = seg.text.trim();
      if (/^Refrigerator$/i.test(t)) refrigerator = "Yes";
      if (/^Range\/Oven$/i.test(t)) rangeOven = "Yes";
      if (/^Disp$/i.test(t) || /^Disposal$/i.test(t)) disposal = "Yes";
      if (/^Dishwasher$/i.test(t)) dishwasher = "Yes";
      if (/^Microwave$/i.test(t)) microwave = "Yes";
      if (/^Washer\/Dryer$/i.test(t)) washerDryer = "Yes";
    }
  }

  // Car storage
  let carStorageType = "", carStorageCount: number | null = null, carStorageOwnership = "";
  for (const l of lines) {
    if (l.y < 415 || l.y > 500) continue;
    for (const seg of l.segments) {
      const t = seg.text.trim();
      if (/^Garage$/i.test(t)) carStorageType = "Garage";
      if (/^# of Cars\s/i.test(t)) carStorageCount = parseNum(extractAfterLabel(seg, /^# of Cars\s+/i));
      if (/^Assigned$/i.test(t)) carStorageOwnership = "Assigned";
      if (/^Owned$/i.test(t)) carStorageOwnership = "Owned";
    }
  }

  // Room count
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

  const meterLine = findLine(lines, /separately metered/i);
  const separatelyMetered = meterLine?.fullText.includes("Yes") ? "Yes" : meterLine?.fullText.includes("No") ? "No" : "";

  const featLine = findLine(lines, /^Additional features/i);
  let additionalFeatures = "";
  if (featLine) {
    const valueSeg = featLine.segments.find((s) => s.x > 180);
    if (valueSeg) additionalFeatures = valueSeg.text.trim();
  }

  const condLine = findLine(lines, /^Describe the condition of the property/i);
  let conditionDescription = "";
  if (condLine) {
    const idx = lines.indexOf(condLine);
    const valueSeg = condLine.segments.find((s) => s.x > 350);
    const parts: string[] = [];
    if (valueSeg) parts.push(valueSeg.text.trim());
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^Are there any physical/i.test(lines[i].fullText) || /^UNIT DESCRIPTION$/i.test(lines[i].fullText.trim())) break;
      const t = lines[i].fullText.trim();
      if (t) parts.push(t);
    }
    conditionDescription = parts.join(" ").trim();
  }

  const defLine = findLine(lines, /physical deficiencies or adverse conditions/i);
  let physicalDeficiencies = "";
  if (defLine) {
    const idx = lines.indexOf(defLine);
    const parts: string[] = [];
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^Does the property generally conform/i.test(lines[i].fullText)) break;
      const t = lines[i].fullText.trim();
      if (t) parts.push(t);
    }
    physicalDeficiencies = parts.join(" ").trim();
  }

  const confLine = findLine(lines, /Does the property generally conform/i);
  let conformity = "";
  if (confLine) {
    const idx = lines.indexOf(confLine);
    const parts: string[] = [];
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^I\s+(did|did not)\s+research/i.test(lines[i].fullText) || /^Freddie Mac Form/i.test(lines[i].fullText)) break;
      const t = lines[i].fullText.trim();
      if (t) parts.push(t);
    }
    conformity = parts.join(" ").trim();
  }

  return {
    floorNumber, numberOfLevels, heatingType, heatingFuel, centralAC,
    floors, walls, trimFinish, bathWainscot, doors,
    fireplaces, deckPatio, porchBalcony,
    refrigerator, rangeOven, disposal, dishwasher, microwave, washerDryer,
    carStorageType, carStorageCount, carStorageOwnership,
    roomCount, bedrooms, baths, grossLivingArea,
    separatelyMetered, additionalFeatures, conditionDescription, physicalDeficiencies, conformity,
    boundingBoxes: bb,
  };
}

// ── Prior Sale History (Page 2 bottom) ───────────────────────────────────

export function parsePriorSaleHistorySection(lines: TextLine[]): PriorSaleHistorySection {
  const bb: Record<string, BoundingBox> = {};

  const researchLine = findLine(lines, /did.*research the sale or transfer/i);
  const researchPerformed = researchLine?.fullText.includes("did not") ? "did not" : "did";

  const subjRevealLine = findLine(lines, /My research.*reveal any prior sales.*subject property/i);
  const subjectPriorSaleRevealed = subjRevealLine?.fullText.includes("did not") ? "did not" : "did";

  const subjDsLine = findLine(lines, /^Data source\(s\)\s+Public Records/i);
  const subjectDataSources = subjDsLine?.fullText.replace(/^Data source\(s\)\s*/i, "").trim() ?? "";

  const compRevealLine = findLine(lines, /My research.*reveal any prior sales.*comparable/i);
  const comparablePriorSaleRevealed = compRevealLine?.fullText.includes("did not") ? "did not" : "did";

  // Look for the second Data source(s) line
  const allDsLines = lines.filter((l) => /^Data source\(s\)/i.test(l.fullText));
  const comparableDataSources = allDsLines.length > 1 ? allDsLines[1].fullText.replace(/^Data source\(s\)\s*/i, "").trim() : "";

  // Prior sale table: ITEM / SUBJECT / COMP1 / COMP2 / COMP3
  const headerLine = findLine(lines, /^ITEM\s+SUBJECT\s+COMPARABLE SALE/i);
  const subject = parsePriorSaleColumn(lines, headerLine, 0);
  const comparables: PriorSaleEntry[] = [];
  for (let i = 1; i <= 3; i++) {
    comparables.push(parsePriorSaleColumn(lines, headerLine, i));
  }

  // Analysis text
  const analysisLine = findLine(lines, /^Analysis of prior sale or transfer/i);
  let analysis = "";
  if (analysisLine) {
    const idx = lines.indexOf(analysisLine);
    const valueSeg = analysisLine.segments.find((s) => s.x > 280);
    const parts: string[] = [];
    if (valueSeg) parts.push(valueSeg.text.trim());
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^Freddie Mac Form/i.test(lines[i].fullText)) break;
      const t = lines[i].fullText.trim();
      if (t) parts.push(t);
    }
    analysis = parts.join(" ").trim();
  }

  return {
    researchPerformed, subjectPriorSaleRevealed, subjectDataSources,
    comparablePriorSaleRevealed, comparableDataSources,
    subject, comparables, analysis, boundingBoxes: bb,
  };
}

function parsePriorSaleColumn(
  lines: TextLine[],
  headerLine: TextLine | undefined,
  colIndex: number,
): PriorSaleEntry {
  const bb: Record<string, BoundingBox> = {};
  if (!headerLine) return { dateOfPriorSale: "", priceOfPriorSale: null, dataSources: "", effectiveDateOfDataSources: "", boundingBoxes: bb };

  // Column x boundaries based on header segments
  const colRanges = [
    { min: 80, max: 180 },   // Subject
    { min: 180, max: 320 },  // Comp 1
    { min: 320, max: 450 },  // Comp 2
    { min: 450, max: 580 },  // Comp 3
  ];
  const col = colRanges[colIndex] ?? colRanges[0];

  function getColValue(line: TextLine | undefined): string {
    if (!line) return "";
    return line.segments
      .filter((s) => s.x >= col.min && s.x < col.max)
      .map((s) => s.text.trim())
      .join(" ")
      .trim();
  }

  const headerIdx = lines.indexOf(headerLine);
  const dateLine = lines[headerIdx + 1];
  const priceLine = lines[headerIdx + 2];
  const dsLine = lines[headerIdx + 3];
  const effLine = lines[headerIdx + 4];

  const dateOfPriorSale = getColValue(dateLine);
  const priceText = getColValue(priceLine);
  const priceOfPriorSale = priceText ? parseCurrency(priceText) : null;
  const dataSources = getColValue(dsLine);
  const effectiveDateOfDataSources = getColValue(effLine);

  return { dateOfPriorSale, priceOfPriorSale, dataSources, effectiveDateOfDataSources, boundingBoxes: bb };
}
