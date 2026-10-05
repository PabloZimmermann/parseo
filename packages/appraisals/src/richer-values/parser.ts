import { extractLines, UnrecognizedFormatError, toBBox } from "@parseo/shared";
import type { TextLine, TextSegment, BoundingBox } from "@parseo/shared";
import type {
  RicherValuesReport,
  CoverPage,
  DateString,
  ValuationSummaryAndParameters,
  ValuationCommentary,
  PropertyDataSourceRow,
  SubjectPropertyDetails,
  ComparableSearchParameters,
  Neighborhood,
  PreparedBy,
  ValuationPage,
  ValuationResults,
  RenovationStrategies,
  RenovationStrategy,
  MarketDemand,
  ComparablesSection,
  Comparable,
  BudgetFlags,
  BudgetFlagSection,
  BudgetFlagEntry,
  MissingLineItem,
  BudgetLineItems,
  BudgetCategory,
  BudgetLineItem,
} from "./types.js";

export async function parseRicherValuesReport(buffer: Buffer): Promise<RicherValuesReport> {
  const lines = await extractLines(buffer);
  return parseRicherValuesReportFromLines(lines);
}

export function parseRicherValuesReportFromLines(lines: TextLine[]): RicherValuesReport {
  // Format fingerprint: Richer Values reports start with "Renovation Analysis" or
  // similar report type, followed by an address, and have "Valuation Summary" on page 2
  const head = lines.slice(0, 15).map((l) => l.fullText).join("\n");
  if (!/Renovation Analysis|Valuation Summary/i.test(head)) {
    throw new UnrecognizedFormatError(
      "RicherValues",
      "first 15 lines do not contain a RicherValues report signature"
    );
  }

  const coverPage = parseCoverPage(lines);
  const valuationSummary = parseValuationSummary(lines);
  const valuationPage = parseValuationPage(lines);
  const closestComparables = parseComparablesSection(lines, "Closest Market Comparables");
  const additionalComparables = parseComparablesSection(lines, "Additional Comparables");
  const excludedComparables = parseComparablesSection(lines, "Additional Comps Excluded From the Analysis");
  const budgetFlags = parseBudgetFlags(lines);
  const budgetLineItems = parseBudgetLineItems(lines);

  return {
    coverPage,
    valuationSummary,
    valuationPage,
    closestComparables,
    additionalComparables,
    excludedComparables,
    budgetFlags,
    budgetLineItems,
  };
}

// ── Cover Page (Page 1) ─────────────────────────────────────────────────────

function parseCoverPage(lines: TextLine[]): CoverPage {
  const page1 = lines.filter((l) => l.page === 1);
  const bb: Record<string, BoundingBox> = {};

  // Report type is the first substantial text line (e.g. "Renovation Analysis")
  const reportTypeLine = page1.find((l) =>
    /renovation analysis|desktop review|bpo|appraisal/i.test(l.fullText)
  );
  const reportType = reportTypeLine?.fullText ?? "";
  if (reportTypeLine?.segments[0]) bb.reportType = toBBox(reportTypeLine.segments[0], reportTypeLine);

  // Address line
  const addressLine = page1.find((l) =>
    /\d+.*,\s*[A-Z]{2},?\s*\d{5}/.test(l.fullText)
  );
  const address = addressLine?.fullText ?? "";
  if (addressLine?.segments[0]) bb.address = toBBox(addressLine.segments[0], addressLine);

  // Property details line — e.g. "1,504 sqft 3 + 2.00; 1962 SFR"
  const detailsLine = page1.find((l) => /sqft/i.test(l.fullText));
  const details = parsePropertyDetails(detailsLine?.fullText ?? "");
  if (detailsLine?.segments[0]) bb.propertyDetails = toBBox(detailsLine.segments[0], detailsLine);

  // Effective date
  const dateLine = page1.find((l) => /effective date/i.test(l.fullText));
  const effectiveDate = parseEffectiveDate(dateLine?.fullText ?? "");
  if (dateLine?.segments[0]) bb.effectiveDate = toBBox(dateLine.segments[0], dateLine);

  // Prepared For block
  const prepIdx = page1.findIndex((l) => /prepared for/i.test(l.fullText));
  const preparedFor = parsePreparedFor(page1);
  if (prepIdx >= 0 && page1[prepIdx + 1]?.segments[0]) {
    bb.preparedForName = toBBox(page1[prepIdx + 1].segments[0], page1[prepIdx + 1]);
  }

  return {
    reportType,
    address,
    ...details,
    effectiveDate,
    preparedFor,
    boundingBoxes: bb,
  };
}

function parsePropertyDetails(text: string): {
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  propertyType: string;
} {
  const sqftMatch = text.match(/([\d,]+)\s*sqft/i);
  const sqft = sqftMatch ? parseInt(sqftMatch[1].replace(/,/g, ""), 10) : null;

  const bedBathMatch = text.match(/(\d+)\s*\+\s*([\d.]+)/);
  const beds = bedBathMatch ? parseInt(bedBathMatch[1], 10) : null;
  const baths = bedBathMatch ? parseFloat(bedBathMatch[2]) : null;

  const yearMatch = text.match(/(\d{4})\s+([A-Z]{2,})/);
  const yearBuilt = yearMatch ? parseInt(yearMatch[1], 10) : null;
  const propertyType = yearMatch ? yearMatch[2] : "";

  return { sqft, beds, baths, yearBuilt, propertyType };
}

function parseEffectiveDate(text: string): DateString {
  const match = text.match(/effective date:\s*(.+)/i);
  if (!match) return "" as DateString;

  const dateStr = match[1].trim();
  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) return dateStr as DateString;

  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}` as DateString;
}

function parsePreparedFor(page1Lines: TextLine[]): { name: string; address: string } {
  const prepIdx = page1Lines.findIndex((l) => /prepared for/i.test(l.fullText));
  if (prepIdx < 0) return { name: "", address: "" };

  const afterLines = page1Lines.slice(prepIdx + 1);
  const name = afterLines[0]?.fullText ?? "";
  const addressParts = afterLines.slice(1).map((l) => l.fullText);
  const address = addressParts.join(", ");

  return { name, address };
}

// ── Valuation Summary and Parameters (Pages 2-N) ────────────────────────────

function findValuationPageNumber(lines: TextLine[]): number {
  const marker = lines.find((l) =>
    l.segments.some((s) => s.text.includes("Estimated As Is Market Value"))
  );
  if (marker) return marker.page;

  const summaryLine = lines.find((l) =>
    /^Valuation Summary$/i.test(l.fullText.trim())
  );
  if (summaryLine) return summaryLine.page;

  return 5;
}

function getBodyLines(lines: TextLine[]): TextLine[] {
  const valPage = findValuationPageNumber(lines);
  return lines.filter(
    (l) =>
      l.page >= 2 &&
      l.page < valPage &&
      !isHeaderOrFooter(l)
  );
}

function isHeaderOrFooter(l: TextLine): boolean {
  const t = l.fullText;
  return (
    /^Renovation Analysis$/i.test(t) ||
    /^\d+.*,\s*[A-Z]{2},?\s*\d{5}$/.test(t) ||
    /^For a complete set of terms/i.test(t)
  );
}

function parseValuationSummary(lines: TextLine[]): ValuationSummaryAndParameters {
  const body = getBodyLines(lines);
  const bb: Record<string, BoundingBox> = {};

  const sectionLine = body.find((l) => /Valuation Summary and Parameters/i.test(l.fullText));
  if (sectionLine?.segments[0]) bb.sectionTitle = toBBox(sectionLine.segments[0], sectionLine);

  return {
    commentary: parseValuationCommentary(body),
    propertyDataSources: parsePropertyDataSources(body),
    subjectPropertyDetails: parseSubjectPropertyDetails(body),
    comparableSearchParameters: parseComparableSearchParameters(body),
    verificationOfCondition: parseVerificationOfCondition(body),
    listingHistory: parseListingHistory(body),
    neighborhood: parseNeighborhood(body),
    preparedBy: parsePreparedBySection(body),
    boundingBoxes: bb,
  };
}

// ── Valuation Commentary ────────────────────────────────────────────────────

const FIELD_BOUNDARY =
  /^(Hyper-Local Neighborhood|Subject Property Assessment|Budget Assessment|Budget Flags|Estimated Valuation|Valuation Commentary):/i;

const SECTION_BOUNDARY =
  /^(Property Data Sources|Subject Property Details|Comparable Search Parameters|Neighborhood:|Verification of Physical|External Data Sources|Prepared By:|Value Drivers|Distance-Based Comps:|Size-Based Comps:|Additional Comps:|Custom Comp Search:|Additional Analyses Conducted:)/i;

function extractCommentaryField(
  body: TextLine[],
  label: string,
  bb?: Record<string, BoundingBox>,
  bbKey?: string,
): string {
  const idx = body.findIndex((l) => l.fullText.includes(label));
  if (idx < 0) return "";

  const firstLine = body[idx];
  const afterLabel = firstLine.fullText.slice(firstLine.fullText.indexOf(label) + label.length).trim();

  // Attach bounding box to the label's segment
  if (bb && bbKey) {
    for (const seg of firstLine.segments) {
      if (seg.text.includes(label.replace(":", ""))) {
        bb[bbKey] = toBBox(seg, firstLine);
        break;
      }
    }
  }

  const parts = [afterLabel];
  for (let i = idx + 1; i < body.length; i++) {
    const text = body[i].fullText;
    if (FIELD_BOUNDARY.test(text) || SECTION_BOUNDARY.test(text)) break;
    parts.push(text);
  }

  return parts.join(" ").trim();
}

function parseValuationCommentary(body: TextLine[]): ValuationCommentary {
  const bb: Record<string, BoundingBox> = {};

  return {
    hyperLocalNeighborhood: extractCommentaryField(body, "Hyper-Local Neighborhood:", bb, "hyperLocalNeighborhood"),
    subjectPropertyAssessment: extractCommentaryField(body, "Subject Property Assessment:", bb, "subjectPropertyAssessment"),
    budgetAssessment: extractCommentaryField(body, "Budget Assessment:", bb, "budgetAssessment"),
    budgetFlags: extractCommentaryField(body, "Budget Flags:", bb, "budgetFlags"),
    estimatedValuation: extractCommentaryField(body, "Estimated Valuation:", bb, "estimatedValuation"),
    boundingBoxes: bb,
  };
}

// ── Property Data Sources ───────────────────────────────────────────────────

function parsePropertyDataSources(body: TextLine[]): PropertyDataSourceRow[] {
  const headerIdx = body.findIndex((l) =>
    /^Property Data Sources$/i.test(l.fullText)
  );
  if (headerIdx < 0) return [];

  const sources = ["Used by RV", "Upload", "MLS", "County", "Manual"];
  const rows: PropertyDataSourceRow[] = [];

  for (const line of body.slice(headerIdx + 1)) {
    const source = sources.find((s) => line.fullText.startsWith(s));
    if (!source) {
      if (rows.length > 0 && /Subject Property/i.test(line.fullText)) break;
      continue;
    }

    const bb: Record<string, BoundingBox> = {};
    bb.source = toBBox(line.segments[0], line);

    const segs = line.segments.slice(1);
    const colNames = ["above", "below", "total", "beds", "baths", "stories", "year", "lot", "garage"];
    const vals: (number | null)[] = [];

    for (let i = 0; i < segs.length; i++) {
      const t = segs[i].text.trim();
      if (t === "-" || t === "") {
        vals.push(null);
      } else {
        vals.push(parseFloat(t.replace(/,/g, "")));
        if (colNames[i]) bb[colNames[i]] = toBBox(segs[i], line);
      }
    }

    rows.push({
      source,
      above: vals[0] ?? null,
      below: vals[1] ?? null,
      total: vals[2] ?? null,
      beds: vals[3] ?? null,
      baths: vals[4] ?? null,
      stories: vals[5] ?? null,
      year: vals[6] ?? null,
      lot: vals[7] ?? null,
      garage: vals[8] ?? null,
      boundingBoxes: bb,
    });
  }

  return rows;
}

// ── Subject Property Details ────────────────────────────────────────────────

function parseSubjectPropertyDetails(body: TextLine[]): SubjectPropertyDetails {
  const bb: Record<string, BoundingBox> = {};
  const secIdx = body.findIndex((l) =>
    /Subject Property Details/i.test(l.fullText)
  );

  const address = findLabelValue(body, secIdx, "Address", bb, "address");
  const apn = findLabelValue(body, secIdx, "Assessor Parcel Number", bb, "apn");
  const comparisonMetrics = findLabelValue(body, secIdx, "Subject Property Comparison Metrics", bb, "comparisonMetrics");

  // Current Use row
  const currentUseLine = body.find(
    (l) => l.page >= 2 && /^Current Use\b/i.test(l.fullText)
  );
  const currentUse = parseCurrentUseRow(currentUseLine);
  if (currentUseLine?.segments[0]) bb.currentUse = toBBox(currentUseLine.segments[0], currentUseLine);

  // Percentile row
  const percentileLine = body.find(
    (l) => l.page >= 2 && /^Percentile\b/i.test(l.fullText)
  );
  const percentile = parsePercentileRow(percentileLine);
  if (percentileLine?.segments[0]) bb.percentile = toBBox(percentileLine.segments[0], percentileLine);

  // Projected Use
  const projectedLine = body.find(
    (l) => l.page >= 2 && /^Projected Use\b/i.test(l.fullText)
  );
  const projectedUse = projectedLine
    ? projectedLine.segments.slice(1).map((s) => s.text).join(" ").trim()
    : "";
  if (projectedLine?.segments[0]) bb.projectedUse = toBBox(projectedLine.segments[0], projectedLine);

  return {
    address,
    apn,
    comparisonMetrics,
    currentUse,
    percentile,
    projectedUse,
    boundingBoxes: bb,
  };
}

function findLabelValue(
  body: TextLine[],
  afterIdx: number,
  label: string,
  bb?: Record<string, BoundingBox>,
  bbKey?: string,
): string {
  if (afterIdx < 0) return "";
  const line = body.slice(afterIdx).find((l) =>
    l.segments.length >= 2 && l.segments[0].text.includes(label)
  );
  if (!line) return "";
  if (bb && bbKey && line.segments[1]) {
    bb[bbKey] = toBBox(line.segments[1], line);
  }
  return line.segments.slice(1).map((s) => s.text).join(" ").trim();
}

function parseCurrentUseRow(
  line: TextLine | undefined
): SubjectPropertyDetails["currentUse"] {
  if (!line) return { type: "", sqft: null, beds: null, baths: null, yearBuilt: null, acres: null };
  const segs = line.segments.slice(1);
  const vals = segs.map((s) => s.text.trim());
  return {
    type: vals[0] ?? "",
    sqft: parseNum(vals[1]),
    beds: parseNum(vals[2]),
    baths: parseNum(vals[3]),
    yearBuilt: parseNum(vals[4]),
    acres: parseNum(vals[5]),
  };
}

function parsePercentileRow(
  line: TextLine | undefined
): SubjectPropertyDetails["percentile"] {
  if (!line) return { sqft: "", beds: "", baths: "", yearBuilt: "", acres: "" };
  const segs = line.segments.slice(1);
  const vals = segs.map((s) => s.text.trim());
  return {
    sqft: vals[0] ?? "",
    beds: vals[1] ?? "",
    baths: vals[2] ?? "",
    yearBuilt: vals[3] ?? "",
    acres: vals[4] ?? "",
  };
}

function parseNum(val: string | undefined): number | null {
  if (!val) return null;
  const clean = val.replace(/,/g, "").trim();
  if (clean === "-" || clean === "") return null;
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

// ── Comparable Search Parameters ────────────────────────────────────────────

function parseComparableSearchParameters(body: TextLine[]): ComparableSearchParameters {
  const bb: Record<string, BoundingBox> = {};

  return {
    distanceBasedComps: extractCommentaryField(body, "Distance-Based Comps:", bb, "distanceBasedComps"),
    sizeBasedComps: extractCommentaryField(body, "Size-Based Comps:", bb, "sizeBasedComps"),
    additionalComps: extractCommentaryField(body, "Additional Comps:", bb, "additionalComps"),
    customCompSearch: extractCommentaryField(body, "Custom Comp Search:", bb, "customCompSearch"),
    additionalAnalyses: extractCommentaryField(body, "Additional Analyses Conducted:", bb, "additionalAnalyses"),
    boundingBoxes: bb,
  };
}

// ── Verification of Condition ───────────────────────────────────────────────

function parseVerificationOfCondition(body: TextLine[]): string {
  const idx = body.findIndex((l) =>
    /Verification of Physical Condition/i.test(l.fullText)
  );
  if (idx < 0) return "";

  const parts: string[] = [];
  for (let i = idx + 1; i < body.length; i++) {
    const t = body[i].fullText;
    if (/Subject Property Listing History/i.test(t)) break;
    parts.push(t);
  }
  return parts.join(" ").trim();
}

// ── Listing History ─────────────────────────────────────────────────────────

function parseListingHistory(body: TextLine[]): string {
  const idx = body.findIndex((l) =>
    /Subject Property Listing History/i.test(l.fullText)
  );
  if (idx < 0) return "";

  const parts: string[] = [];
  for (let i = idx + 1; i < body.length; i++) {
    const t = body[i].fullText;
    if (/^Neighborhood:/i.test(t)) break;
    parts.push(t);
  }
  return parts.join(" ").trim();
}

// ── Neighborhood ────────────────────────────────────────────────────────────

function parseNeighborhood(body: TextLine[]): Neighborhood {
  const bb: Record<string, BoundingBox> = {};

  const labelValue = (label: string, bbKey: string): string => {
    const line = body.find((l) =>
      l.segments.length >= 1 && l.segments[0].text.includes(label)
    );
    if (!line) return "";
    const valSeg = line.segments[1];
    if (valSeg) bb[bbKey] = toBBox(valSeg, line);
    return line.segments.slice(1).map((s) => s.text).join(" ").trim();
  };

  // Land use types — label and value lines interleaved by y position
  const landUseLabelIdx = body.findIndex((l) =>
    l.segments.some((s) => s.text.includes("Land Use Types Present"))
  );
  const landUseConcernsIdx = body.findIndex((l) =>
    l.segments.some((s) => s.text.includes("Land Use Concerns"))
  );
  let landUseTypesPresent = "";
  if (landUseLabelIdx >= 0) {
    const startIdx = Math.max(0, landUseLabelIdx - 2);
    const endIdx = landUseConcernsIdx > landUseLabelIdx ? landUseConcernsIdx : landUseLabelIdx + 3;
    const valueParts: string[] = [];
    let firstValSeg = false;
    for (let i = startIdx; i < endIdx; i++) {
      for (const seg of body[i].segments) {
        if (!seg.text.includes("Land Use Types Present") && seg.x >= 200) {
          valueParts.push(seg.text.trim());
          if (!firstValSeg) {
            bb.landUseTypesPresent = toBBox(seg, body[i]);
            firstValSeg = true;
          }
        }
      }
    }
    landUseTypesPresent = valueParts.join(" ").replace(/\s+/g, " ").replace(/,\s*$/, "").trim();
  }

  // Flood info
  const floodMapLine = body.find((l) =>
    l.segments.some((s) => s.text.includes("Map Number"))
  );
  const floodMapNumber = floodMapLine
    ? floodMapLine.segments[floodMapLine.segments.length - 1].text.trim()
    : "";
  if (floodMapLine) {
    const valSeg = floodMapLine.segments[floodMapLine.segments.length - 1];
    bb.floodMapNumber = toBBox(valSeg, floodMapLine);
  }

  const mapDateLine = body.find((l) =>
    l.segments.some((s) => s.text.includes("Map Effective Date"))
  );
  const floodMapEffectiveDate = mapDateLine
    ? mapDateLine.segments[mapDateLine.segments.length - 1].text.trim()
    : "";
  if (mapDateLine) {
    const valSeg = mapDateLine.segments[mapDateLine.segments.length - 1];
    bb.floodMapEffectiveDate = toBBox(valSeg, mapDateLine);
  }

  const floodZoneLine = body.find((l) =>
    l.segments.some((s) => s.text.includes("Is it in the Flood Zone?"))
  );
  const isInFloodZone = floodZoneLine
    ? floodZoneLine.segments[floodZoneLine.segments.length - 1].text.trim()
    : "";
  if (floodZoneLine) {
    const valSeg = floodZoneLine.segments[floodZoneLine.segments.length - 1];
    bb.isInFloodZone = toBBox(valSeg, floodZoneLine);
  }

  const specialFloodLine = body.find((l) =>
    l.segments.some((s) => s.text.includes("Special Flood Hazard"))
  );
  const isInSpecialFloodHazard = specialFloodLine
    ? specialFloodLine.segments[specialFloodLine.segments.length - 1].text.trim()
    : "";
  if (specialFloodLine) {
    const valSeg = specialFloodLine.segments[specialFloodLine.segments.length - 1];
    bb.isInSpecialFloodHazard = toBBox(valSeg, specialFloodLine);
  }

  // Conformance
  const conformanceLine = body.find((l) =>
    l.segments.some((s) => s.text.includes("conformance issues"))
  );
  let conformanceIssues = "";
  if (conformanceLine) {
    const confIdx = conformanceLine.segments.findIndex((s) =>
      s.text.includes("conformance issues")
    );
    const answer = conformanceLine.segments[confIdx + 1];
    if (answer && !answer.text.includes("Map Effective")) {
      conformanceIssues = answer.text.trim();
      bb.conformanceIssues = toBBox(answer, conformanceLine);
    }
  }

  // Ownership
  const ownershipLine = body.find((l) =>
    l.segments.some((s) => /^Leasehold$/i.test(s.text.trim()))
  );
  let ownership = "";
  if (ownershipLine) {
    const leaseIdx = ownershipLine.segments.findIndex((s) =>
      /^Leasehold$/i.test(s.text.trim())
    );
    const answer = ownershipLine.segments[leaseIdx + 1];
    if (answer && !answer.text.includes("Flood")) {
      ownership = answer.text.trim();
      bb.ownership = toBBox(answer, ownershipLine);
    }
  }

  // Zoning
  const zoningLine = body.find((l) =>
    l.page >= 3 && l.segments.length >= 2 && l.segments.some((s) => s.text.includes("Flood Information"))
  );
  const zoningIdx = zoningLine ? body.indexOf(zoningLine) : -1;
  let zoningText = "";
  if (zoningIdx >= 0 && zoningIdx + 1 < body.length) {
    const nextLine = body[zoningIdx + 1];
    zoningText = nextLine.segments[0]?.text.trim() ?? "";
    if (nextLine.segments[0]) bb.zoning = toBBox(nextLine.segments[0], nextLine);
  }

  return {
    landUseTypesPresent,
    landUseConcerns: labelValue("Land Use Concerns:", "landUseConcerns"),
    averageAgeOfResidentialUnits: labelValue("Average Age of Residential Units:", "averageAgeOfResidentialUnits"),
    averageBuildingCondition: labelValue("Average Building Condition:", "averageBuildingCondition"),
    averageBuildingQuality: labelValue("Average Building Quality:", "averageBuildingQuality"),
    soldCompPercentRemodeled: labelValue("Sold Comp Percent Remodeled:", "soldCompPercentRemodeled"),
    zoning: zoningText,
    floodMapNumber,
    floodMapEffectiveDate,
    isInFloodZone,
    isInSpecialFloodHazard,
    conformanceIssues,
    ownership,
    boundingBoxes: bb,
  };
}

// ── Prepared By ─────────────────────────────────────────────────────────────

function parsePreparedBySection(body: TextLine[]): PreparedBy {
  const bb: Record<string, BoundingBox> = {};
  const line = body.find((l) => /^Prepared By:/i.test(l.fullText));
  if (!line) return { name: "", email: "", phone: "", date: "", boundingBoxes: bb };

  if (line.segments[0]) bb.preparedBy = toBBox(line.segments[0], line);

  const text = line.fullText.replace(/^Prepared By:\s*/i, "");
  const emailMatch = text.match(/([\w.+-]+@[\w.-]+)/);
  const phoneMatch = text.match(/(\(?\d{3}\)?\s*[\d-]{7,})/);

  const email = emailMatch ? emailMatch[1] : "";
  const phone = phoneMatch ? phoneMatch[1] : "";

  let name = text;
  if (emailMatch) name = name.slice(0, name.indexOf(emailMatch[1]));
  name = name.replace(/,\s*$/, "").trim();

  // Date is on a subsequent line
  const lineIdx = body.indexOf(line);
  let date = "";
  for (let i = lineIdx + 1; i < body.length; i++) {
    const t = body[i].fullText;
    if (/\d{4}/.test(t) && /AM|PM/i.test(t)) {
      date = t.trim();
      if (body[i].segments[0]) bb.date = toBBox(body[i].segments[0], body[i]);
      break;
    }
  }

  return { name, email, phone, date, boundingBoxes: bb };
}

// ── Valuation Page ─────────────────────────────────────────────────────────

function parseValuationPage(lines: TextLine[]): ValuationPage {
  const valPage = findValuationPageNumber(lines);
  const pageLines = lines.filter(
    (l) => l.page === valPage && !isHeaderOrFooter(l)
  );

  return {
    valuationResults: parseValuationResults(pageLines),
    renovationStrategies: parseRenovationStrategies(pageLines),
    marketDemand: parseMarketDemand(pageLines),
  };
}

function parseValuationResults(body: TextLine[]): ValuationResults {
  const bb: Record<string, BoundingBox> = {};

  const fieldVal = (label: string, bbKey: string): string => {
    const line = body.find((l) => l.segments[0]?.text.includes(label));
    if (!line) return "";
    const valSeg = line.segments[line.segments.length - 1];
    if (valSeg && valSeg !== line.segments[0]) bb[bbKey] = toBBox(valSeg, line);
    return valSeg?.text.trim() ?? "";
  };

  const currentCondition = fieldVal("Current Condition", "currentCondition");
  const asIs = fieldVal("Estimated As Is Market Value", "estimatedAsIsMarketValue");
  const budget = fieldVal("Borrower Budget", "borrowerBudget");
  const targetCondition = fieldVal("Borrower Target Condition", "borrowerTargetCondition");
  const arv = fieldVal("Estimated ARV at Target Condition", "estimatedARV");

  return {
    currentCondition,
    estimatedAsIsMarketValue: parseCurrency(asIs),
    borrowerBudget: parseCurrency(budget),
    borrowerTargetCondition: targetCondition,
    estimatedARV: parseCurrency(arv),
    boundingBoxes: bb,
  };
}

function parseCurrency(val: string): number | null {
  const clean = val.replace(/[$,]/g, "").trim();
  if (!clean) return null;
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

function parseRenovationStrategies(body: TextLine[]): RenovationStrategies {
  const bb: Record<string, BoundingBox> = {};

  // Find the column header line with Min, Partial, Full, Best
  const headerLine = body.find((l) =>
    l.segments.some((s) => s.text.trim() === "Min") &&
    l.segments.some((s) => s.text.trim() === "Full")
  );
  if (headerLine?.segments[0]) bb.header = toBBox(headerLine.segments[0], headerLine);

  // Determine value column boundaries from the header. The fourth column is
  // "Best" in most reports but "Value Add 1" (and sometimes more) in others,
  // so take every header cell from "Min" onwards as a column.
  const headerSegs = headerLine ? headerLine.segments.map((s) => ({ ...s, text: s.text.trim() })).filter((s) => s.text) : [];
  const minIdx = headerSegs.findIndex((s) => s.text === "Min");
  const columnSegs = minIdx >= 0 ? headerSegs.slice(minIdx) : [];
  const columnLabels = columnSegs.map((s) => s.text);
  const minSeg = columnSegs[0];
  const lastSeg = columnSegs[columnSegs.length - 1];
  const valXMin = minSeg ? minSeg.x - 15 : 75;
  const valXMax = lastSeg ? lastSeg.x + lastSeg.width + 15 : 290;

  // Extract value segments: within the strategy column range only
  const getValSegs = (line: TextLine) =>
    line.segments.filter((s) => s.x >= valXMin && s.x <= valXMax);

  // Row parser: find line by label, extract 4 values from segments
  const getRow = (label: string): (string | undefined)[] => {
    const line = body.find((l) =>
      l.segments.some((s) => s.text.trim() === label || s.text.includes(label))
    );
    if (!line) return [undefined, undefined, undefined, undefined];
    return getValSegs(line).map((s) => s.text.trim());
  };

  // Find a table row: line must have a label AND at least 3 value segments
  const getRowWithBB = (label: string, bbPrefix: string): (string | undefined)[] => {
    const line = body.find((l) => {
      const hasLabel = l.segments.some((s) => s.text.trim() === label || s.text.includes(label));
      const valCount = getValSegs(l).length;
      return hasLabel && valCount >= 3;
    });
    if (!line) return [undefined, undefined, undefined, undefined];

    const valSegs = getValSegs(line);
    const strategies = ["min", "partial", "full", "best"];
    valSegs.forEach((s, i) => {
      if (strategies[i]) bb[`${bbPrefix}_${strategies[i]}`] = toBBox(s, line);
    });
    return valSegs.map((s) => s.text.trim());
  };

  const arvRow = getRowWithBB("ARV", "arv");
  // "As Is Value" line has a quirk — first segment may include "As Is Value $580,000"
  const asIsLine = body.find((l) =>
    l.segments.some((s) => s.text.includes("As Is Value"))
  );
  let asIsRow: (string | undefined)[] = [undefined, undefined, undefined, undefined];
  if (asIsLine) {
    const asIsValSegs = getValSegs(asIsLine);
    // First value may be embedded in "As Is Value $580,000"
    const embedded = asIsLine.segments.find((s) => s.text.includes("As Is Value"))?.text.match(/\$([\d,]+)/)?.[0];
    if (embedded && asIsValSegs.length < 4) {
      asIsRow = [embedded, ...asIsValSegs.map((s) => s.text.trim())];
    } else {
      asIsRow = asIsValSegs.map((s) => s.text.trim());
    }
  }

  const rehabRow = getRowWithBB("Rehab", "rehab");
  const sqftRow = getRowWithBB("$/sqft", "perSqft");
  const basisRow = getRowWithBB("Basis", "basis");
  const netLiftRow = getRowWithBB("Net Lift", "netLift");

  // Gross Return — may be split: "Gross" on one line, percentages on another, "Return" on a third
  // Look for any line with percentage values in the strategy column range
  const grossReturnLine = body.find((l) => {
    const pctSegs = l.segments.filter((s) => /\d+\.\d+%/.test(s.text) && s.x >= valXMin);
    return pctSegs.length >= 3;
  });
  const returnVals = grossReturnLine
    ? grossReturnLine.segments.filter((s) => /\d+\.\d+%/.test(s.text)).map((s) => s.text.trim())
    : [];
  const returnStrategies = ["min", "partial", "full", "best"];
  if (grossReturnLine) {
    grossReturnLine.segments.filter((s) => /\d+\.\d+%/.test(s.text)).forEach((s, i) => {
      if (returnStrategies[i]) bb[`grossReturn_${returnStrategies[i]}`] = toBBox(s, grossReturnLine);
    });
  }

  // Timeline rows — use getValSegs for position-independent extraction
  const rehabTimeLine = body.find((l) =>
    l.segments.some((s) => /Rehab Time/.test(s.text))
  );
  const rehabTimeVals = rehabTimeLine
    ? getValSegs(rehabTimeLine).map((s) => s.text.trim())
    : [];

  const ttsLine = body.find((l) =>
    l.segments.some((s) => s.text.trim() === "Estim TTS")
  );
  const ttsVals = ttsLine
    ? getValSegs(ttsLine).map((s) => s.text.trim())
    : [];

  const cushionLine = body.find((l) =>
    l.segments.some((s) => s.text.trim() === "Cushion")
  );
  const cushionVals = cushionLine
    ? getValSegs(cushionLine).map((s) => s.text.trim())
    : [];

  const totalTimeLine = body.find((l) =>
    l.segments.some((s) => s.text.trim() === "Total Time")
  );
  const totalTimeVals = totalTimeLine
    ? getValSegs(totalTimeLine).map((s) => s.text.trim())
    : [];

  // Annualized Return — may be split across lines, look for "1.42x" style values
  const annReturnLine = body.find((l) =>
    l.segments.some((s) => /\d+\.\d+x/.test(s.text))
  );
  const annReturnVals = annReturnLine
    ? annReturnLine.segments.filter((s) => /\d+\.\d+x/.test(s.text)).map((s) => s.text.trim())
    : [];

  const buildStrategy = (i: number): RenovationStrategy => {
    const stratBb: Record<string, BoundingBox> = {};
    if (i < 0) {
      return { arv: null, asIsValue: null, rehab: null, perSqft: null, basis: null, netLift: null, grossReturn: "", rehabTime: null, estimatedTTS: null, cushion: null, totalTime: null, annualizedReturn: "", boundingBoxes: stratBb };
    }

    // Copy relevant bounding boxes for this strategy column
    const prefix = ["min", "partial", "full", "best"][i];
    for (const [k, v] of Object.entries(bb)) {
      if (k.endsWith(`_${prefix}`)) {
        stratBb[k.replace(`_${prefix}`, "")] = v;
      }
    }

    return {
      arv: parseCurrency(arvRow[i] ?? ""),
      asIsValue: parseCurrency(asIsRow[i] ?? ""),
      rehab: parseCurrency(rehabRow[i] ?? ""),
      perSqft: parseCurrency(sqftRow[i] ?? ""),
      basis: parseCurrency(basisRow[i] ?? ""),
      netLift: parseCurrency(netLiftRow[i] ?? ""),
      grossReturn: returnVals[i] ?? "",
      rehabTime: parseNum(rehabTimeVals[i]),
      estimatedTTS: parseNum(ttsVals[i]),
      cushion: parseNum(cushionVals[i]),
      totalTime: parseNum(totalTimeVals[i]),
      annualizedReturn: annReturnVals[i] ?? "",
      boundingBoxes: stratBb,
    };
  };

  const bestIdx = columnLabels.findIndex((l) => /^Best$/i.test(l));
  const valueAddIdx = columnLabels.findIndex((l) => /^Value Add/i.test(l));
  return {
    columnLabels,
    min: buildStrategy(0),
    partial: buildStrategy(1),
    full: buildStrategy(2),
    // Older reports label the fourth column "Best"; keep that index when no label is known.
    best: buildStrategy(bestIdx >= 0 ? bestIdx : columnLabels.length === 0 ? 3 : -1),
    valueAdd: valueAddIdx >= 0 ? buildStrategy(valueAddIdx) : null,
    boundingBoxes: bb,
  };
}

function parseMarketDemand(body: TextLine[]): MarketDemand {
  const bb: Record<string, BoundingBox> = {};

  // Market Demand line: "Market Demand", score, "Return", ...
  const demandLine = body.find((l) =>
    l.segments.some((s) => s.text.includes("Market Demand"))
  );
  let score: number | null = null;
  if (demandLine) {
    const scoreSeg = demandLine.segments.find((s) => /^\d+$/.test(s.text.trim()));
    if (scoreSeg) {
      score = parseInt(scoreSeg.text.trim(), 10);
      bb.score = toBBox(scoreSeg, demandLine);
    }
  }

  // "Strong"/"Moderate"/"Weak" label — appears after the Market Demand line,
  // may share a line with other segments. Search only after the demand line.
  const demandIdx = demandLine ? body.indexOf(demandLine) : -1;
  const afterDemand = demandIdx >= 0 ? body.slice(demandIdx + 1) : body;
  const strongLine = afterDemand.find((l) =>
    l.segments.some((s) => /^(Strong|Moderate|Weak)$/i.test(s.text.trim()))
  );
  const strongSeg = strongLine?.segments.find((s) =>
    /^(Strong|Moderate|Weak)$/i.test(s.text.trim())
  );
  const label = strongSeg?.text.trim() ?? "";
  if (strongSeg && strongLine) bb.label = toBBox(strongSeg, strongLine);

  // Left-side fields — value is in seg[1], but may be merged with right-side table label.
  // Only take the portion before known table labels (e.g., "Rehab Time", "Estim TTS").
  const tableLabels = /\b(Rehab Time|Estim TTS|Cushion|Total Time|Annualized)/;
  const leftField = (fieldLabel: string, bbKey: string): string => {
    const line = body.find((l) =>
      l.segments[0]?.text.trim() === fieldLabel ||
      l.segments[0]?.text.includes(fieldLabel)
    );
    if (!line || line.segments.length < 2) return "";
    const valSeg = line.segments[1];
    if (valSeg && valSeg.x < 350) {
      bb[bbKey] = toBBox(valSeg, line);
      let val = valSeg.text.trim();
      // Strip any table label that got merged into this segment
      const tableMatch = val.match(tableLabels);
      if (tableMatch) val = val.slice(0, tableMatch.index).trim();
      return val;
    }
    return "";
  };

  return {
    score,
    label,
    location: leftField("Location", "location"),
    inventory: leftField("Inventory", "inventory"),
    medianTTS: leftField("Median TTS", "medianTTS"),
    percentRemodeled: leftField("% Remodeled", "percentRemodeled"),
    boundingBoxes: bb,
  };
}

// ── Comparables (Pages 6, 11, 15-17) ────────────────────────────────────────

/** Condition group headers in the comp tables */
const CONDITION_GROUPS = [
  "Newly Built", "Full Remodel", "Partial Remodel", "Maintained",
  "Moderate", "Poor", "Very Poor", "Unsalvageable",
];

function parseComparablesSection(lines: TextLine[], sectionTitle: string): ComparablesSection {
  const headerIdx = lines.findIndex((l) => l.fullText.includes(sectionTitle));
  if (headerIdx < 0) return { title: sectionTitle, comparables: [] };

  const headerPage = lines[headerIdx].page;

  // Collect table lines from this section until next section or photo pages
  const tableLines: TextLine[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^Photos for/i.test(line.fullText)) break;
    if (line.page > headerPage + 5) break;
    if (
      /^(Closest Market Comparables|Additional Comparables|Additional Comps Excluded|Budget Flags|Budget Line Items)$/i.test(line.fullText) &&
      line.page !== headerPage
    ) break;
    if (isHeaderOrFooter(line)) continue;
    tableLines.push(line);
  }

  // Column headers reveal the layout: multi-unit reports add a "Unt" column
  // between Lot and Dist; some markets print Above/Below/Total square footage
  // instead of a single Sqft column.
  const headerLines = tableLines.filter((l) => l.segments[0]?.text.trim() === "#");
  const hasUnits = headerLines.some((l) => /\bUnt\b/.test(l.fullText));
  const hasAboveBelow = headerLines.some((l) => /\bAbove\b.*\bBelow\b.*\bTotal\b/.test(l.fullText));

  // Condition group of each row comes from the "#  <group>" header above it.
  const groupAt = new Map<TextLine, string>();
  let currentGroup = "";
  for (const line of tableLines) {
    const firstSeg = line.segments[0]?.text.trim();
    if (firstSeg === "#" && line.segments.length >= 2) {
      const groupName = line.segments[1]?.text.trim();
      if (CONDITION_GROUPS.some((g) => groupName === g)) currentGroup = groupName;
      continue;
    }
    groupAt.set(line, currentGroup);
  }

  // A comp row starts with its number and carries a sale date; a wrapped
  // address spills onto the lines just above/below it.
  const isCompAnchor = (l: TextLine) => {
    const first = l.segments[0];
    if (!first || first.x >= 45 || !/^\d+(\s|$)/.test(first.text.trim())) return false;
    return /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(l.fullText);
  };
  const rowLines = tableLines.filter((l) => {
    const first = l.segments[0]?.text.trim();
    return first !== "#" && first !== "S";
  });
  const rows = clusterRows(rowLines, isCompAnchor);

  const comparables: Comparable[] = [];
  for (const { anchor, segs } of rows) {
    const num = parseInt(anchor.segments[0].text.trim(), 10);
    const comp = parseCompRow(anchor, segs, num, groupAt.get(anchor) ?? "", { hasUnits, hasAboveBelow });
    if (comp) comparables.push(comp);
  }

  return { title: sectionTitle, comparables };
}

interface CompLayout {
  hasUnits: boolean;
  hasAboveBelow: boolean;
}

const COMP_DATE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
const COMP_YEAR = /^(18|19|20)\d{2}$/;
const PROPERTY_TYPE_CODE = /^(C|TH|SF|DP|TP|QP|MF|MU|FM|VL|CRE|UKM|MFR|UK)$/;

/**
 * One comp row. Works on whitespace tokens in reading order because pdf text
 * runs merge cells unpredictably (the number, address and first sqft column
 * can share one run; a wrapped address spans three lines). Shape:
 *   # address [Type] [Above Below] Total Bd Bth Year [Stories] Lot [Unt] Dist [Flags] [Grg] COE SP $/sqft [C] TTS [Score]
 * The row is anchored on the Year column: the first 4-digit year (scanning
 * back from the sale date) that is preceded by Bth, Bd and Total.
 */
function parseCompRow(line: TextLine, segs: Seg[], num: number, group: string, layout: CompLayout): Comparable | null {
  const tokens: { text: string; seg: Seg }[] = [];
  for (const seg of sortReading(segs)) for (const t of seg.text.split(/\s+/)) if (t) tokens.push({ text: t, seg });
  // Drop the row number
  if (tokens[0]?.text === String(num)) tokens.shift();
  else if (tokens[0]) tokens[0] = { ...tokens[0], text: tokens[0].text.replace(new RegExp(`^${num}\\s*`), "") };

  const texts = tokens.map((t) => t.text);
  const dateIdx = texts.findIndex((t) => COMP_DATE.test(t));
  if (dateIdx < 0) return null;

  const isNum = (t: string | undefined) => t !== undefined && /^[\d,]+(\.\d+)?$/.test(t);
  let yearIdx = -1;
  for (let i = dateIdx - 1; i >= 3; i--) {
    if (COMP_YEAR.test(texts[i]) && isNum(texts[i - 1]) && /^\d+$/.test(texts[i - 2] ?? "") && isNum(texts[i - 3])) {
      yearIdx = i;
      break;
    }
  }
  if (yearIdx < 0) return null;

  const sqftCols = layout.hasAboveBelow ? 3 : 1;
  const totalIdx = yearIdx - 3;
  const firstSqftIdx = totalIdx - (sqftCols - 1);
  if (firstSqftIdx < 0) return null;

  const toInt = (t: string | undefined) => (t !== undefined && /^[\d,]+$/.test(t) ? parseInt(t.replace(/,/g, ""), 10) : null);
  const sqft = toInt(texts[totalIdx]);
  const sqftAbove = layout.hasAboveBelow ? toInt(texts[totalIdx - 2]) : null;
  const sqftBelow = layout.hasAboveBelow ? toInt(texts[totalIdx - 1]) : null;
  const beds = parseInt(texts[yearIdx - 2], 10);
  const baths = parseFloat(texts[yearIdx - 1]);
  const yearBuilt = parseInt(texts[yearIdx], 10);

  // Address: everything before the sqft columns, minus a trailing property-type code
  const addrTokens = tokens.slice(0, firstSqftIdx);
  let propertyType: string | null = null;
  if (addrTokens.length > 1 && PROPERTY_TYPE_CODE.test(addrTokens[addrTokens.length - 1].text)) {
    propertyType = addrTokens.pop()!.text;
  }
  const address = addrTokens.map((t) => t.text).join(" ").replace(/\s+/g, " ").trim();
  if (!address) return null;

  // Between Year and COE: [Stories] Lot [Unt] Dist [Flags] [Grg]
  let mid = texts.slice(yearIdx + 1, dateIdx);
  let stories: number | null = null;
  // Stories prints as 1.00 / 1.50 / 2.00; condo reports omit the column, in
  // which case the row has at most two decimals (Lot, Dist) before the ints.
  const hasStories = mid.length >= 3 && (/^\d\.(00|50)$/.test(mid[0]) || mid.slice(0, 3).every((t) => t.includes(".")));
  if (hasStories) {
    stories = parseFloat(mid[0]);
    mid = mid.slice(1);
  }
  const lotTok = mid[0];
  const lot = lotTok === undefined || lotTok === "unkn" ? null : parseFloat(lotTok);
  mid = mid.slice(1);
  let units: number | null = null;
  if (layout.hasUnits && /^\d+$/.test(mid[0] ?? "")) {
    units = parseInt(mid[0], 10);
    mid = mid.slice(1);
  }
  const distIdx = mid.findIndex((t) => t.includes("."));
  const distTokIdx = distIdx >= 0 ? distIdx : mid.findIndex((t) => /^\d+$/.test(t));
  const dist = distTokIdx >= 0 ? parseFloat(mid[distTokIdx]) : null;
  const ints = mid.filter((t, i) => i !== distTokIdx && /^\d+$/.test(t));
  let flags: number | null = null;
  let garage: number | null = null;
  if (ints.length >= 2) {
    flags = parseInt(ints[0], 10);
    garage = parseInt(ints[1], 10);
  } else if (ints.length === 1) {
    garage = parseInt(ints[0], 10);
  }

  const closeOfEscrow = texts[dateIdx];
  const spTok = texts[dateIdx + 1] ?? "";
  const psfTok = texts[dateIdx + 2] ?? "";
  const salePrice = /^\$[\d,]+$/.test(spTok) ? parseInt(spTok.replace(/[$,]/g, ""), 10) : null;
  const pricePerSqft = /^\$[\d,]+$/.test(psfTok) ? parseInt(psfTok.replace(/[$,]/g, ""), 10) : null;

  // After $/sqft: one number = TTS; two = C, TTS; three = C, TTS, Score.
  const rest = texts.slice(dateIdx + 3).filter((t) => /^[\d.]+$/.test(t));
  let condition: number | null = null;
  let timeToSale: number | null = null;
  let score: number | null = null;
  if (rest.length === 1) {
    timeToSale = parseInt(rest[0], 10);
  } else if (rest.length === 2) {
    condition = parseFloat(rest[0]);
    timeToSale = parseInt(rest[1], 10);
  } else if (rest.length >= 3) {
    condition = parseFloat(rest[0]);
    timeToSale = parseInt(rest[1], 10);
    score = parseFloat(rest[2]);
  }

  // Bounding boxes: the text run each value was read from.
  const bb: Record<string, BoundingBox> = {};
  const box = (idx: number) => (tokens[idx] ? toBBox(tokens[idx].seg, line) : undefined);
  const set = (key: string, idx: number) => {
    const b = box(idx);
    if (b) bb[key] = b;
  };
  if (addrTokens[0]) bb.address = toBBox(addrTokens[0].seg, line);
  set("sqft", totalIdx);
  set("beds", yearIdx - 2);
  set("baths", yearIdx - 1);
  set("yearBuilt", yearIdx);
  set("closeOfEscrow", dateIdx);
  set("salePrice", dateIdx + 1);
  set("pricePerSqft", dateIdx + 2);
  const restStart = dateIdx + 3;
  if (rest.length >= 2) set("condition", restStart);
  set("timeToSale", restStart + (rest.length >= 2 ? 1 : 0));
  if (rest.length >= 3) set("score", restStart + 2);

  return {
    number: num,
    address,
    propertyType,
    conditionGroup: group,
    sqft,
    sqftAbove,
    sqftBelow,
    beds,
    baths,
    yearBuilt,
    stories,
    lot,
    distance: dist,
    units,
    flags,
    garage,
    closeOfEscrow,
    salePrice,
    pricePerSqft,
    condition,
    timeToSale,
    score,
    boundingBoxes: bb,
  };
}

// ── Shared helpers for the budget tables ─────────────────────────────────────

const CONCERN_LEVELS = [
  "Significant Concerns",
  "Medium Concerns",
  "Moderate Concerns",
  "Cautionary Concerns",
];

/** Badges RicherValues prints in Flag columns and before line item names. */
const FLAG_BADGE = /^(VERY HIGH|VERY LOW|HIGH|LOW|MED|MEDIUM|MISSING)$/i;
const LEADING_BADGE = /^(VERY HIGH|VERY LOW|HIGH|LOW|MED|MEDIUM)\s+(?=\S)/i;
const MONEY_TOKEN = /^[+-]?\$[\d,]+(?:\.\d+)?$/;

interface Seg extends TextSegment {
  y: number;
  page: number;
}

/** Table rows are 16pt apart; a wrapped cell prints its halves ~5-8pt above and below the row. */
const WRAP_TOLERANCE = 9;

function parseSignedCurrency(text: string): number | null {
  const m = text.replace(/\s/g, "").match(/^([+-]?)\$([\d,]+(?:\.\d+)?)$/);
  if (!m) return null;
  const n = parseFloat(m[2].replace(/,/g, ""));
  return m[1] === "-" ? -n : n;
}

function lineSegs(line: TextLine): Seg[] {
  return line.segments
    .map((s) => ({ ...s, text: s.text.trim(), y: line.y, page: line.page }))
    .filter((s) => s.text);
}

/**
 * Group table lines into logical rows. A line is an "anchor" when `isAnchor`
 * says so (it carries money, a row number...); every other line is a wrapped
 * cell fragment and is attached to the nearest anchor within WRAP_TOLERANCE.
 * Unattached fragments are dropped.
 */
function clusterRows(lines: TextLine[], isAnchor: (l: TextLine) => boolean): { anchor: TextLine; segs: Seg[] }[] {
  const rows = lines.filter(isAnchor).map((anchor) => ({ anchor, segs: lineSegs(anchor) }));
  for (const line of lines) {
    if (isAnchor(line)) continue;
    let best: (typeof rows)[number] | null = null;
    let bestDy = Infinity;
    for (const row of rows) {
      if (row.anchor.page !== line.page) continue;
      const dy = Math.abs(row.anchor.y - line.y);
      if (dy < bestDy) {
        bestDy = dy;
        best = row;
      }
    }
    if (best && bestDy <= WRAP_TOLERANCE) best.segs.push(...lineSegs(line));
  }
  return rows;
}

/** Segments of one logical row in reading order: by column (x), then top to bottom within a column. */
function sortReading(segs: Seg[], xTolerance = 14): Seg[] {
  return [...segs].sort((a, b) => (Math.abs(a.x - b.x) <= xTolerance ? a.y - b.y : a.x - b.x));
}

function joinColumn(segs: Seg[]): string {
  return sortReading(segs).map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
}

// ── Budget Flags (Page 18) ────────────────────────────────────────────────────

function parseBudgetFlags(lines: TextLine[]): BudgetFlags {
  const headerIdx = lines.findIndex((l) => /^Budget Flags$/i.test(l.fullText.trim()));
  const headerPage = headerIdx >= 0 ? lines[headerIdx].page : -1;

  const body = headerIdx >= 0
    ? lines.filter((l) => l.page === headerPage && !isHeaderOrFooter(l) && l.y > lines[headerIdx].y)
    : [];

  const bb: Record<string, BoundingBox> = {};
  if (headerIdx >= 0) {
    const hl = lines[headerIdx];
    bb.title = toBBox(hl.segments[0], hl);
  }

  const concerns: BudgetFlagSection[] = [];

  for (let i = 0; i < CONCERN_LEVELS.length; i++) {
    const level = CONCERN_LEVELS[i];
    const levelIdx = body.findIndex((l) => l.fullText.trim() === level);
    if (levelIdx < 0) continue;

    const sectionBB: Record<string, BoundingBox> = {};
    const levelLine = body[levelIdx];
    sectionBB.level = toBBox(levelLine.segments[0], levelLine);

    // Collect items until next concern level or "Missing Line Items"
    const items: string[] = [];
    const sectionLines: TextLine[] = [];
    for (let j = levelIdx + 1; j < body.length; j++) {
      const text = body[j].fullText.trim();
      if (CONCERN_LEVELS.includes(text) || /^Missing Line Items$/i.test(text)) break;
      if (text && !/^No line items flagged\.?$/i.test(text) && !/^Specific Line Item/i.test(text)) {
        items.push(text);
        sectionBB[`item${items.length}`] = toBBox(body[j].segments[0], body[j]);
        sectionLines.push(body[j]);
      }
    }

    // A flagged row starts at the left margin (badge or item name) and carries
    // its Budget amount; wrapped Item/Diff/Notes cells sit on neighbouring lines.
    const startsAtMargin = (l: TextLine) => {
      const first = l.segments.find((s) => s.text.trim());
      return !!first && first.x < 70;
    };
    const startsWithBadge = (l: TextLine) => {
      const first = l.segments.find((s) => s.text.trim())?.text.trim().split(/\s+/) ?? [];
      return FLAG_BADGE.test(first[0] ?? "") || FLAG_BADGE.test(`${first[0]} ${first[1]}`);
    };
    // Prefer badge-led lines as anchors (a wrapped Diff cell can also start a
    // line with money); fall back to any margin line with money.
    const hasBadgeAnchors = sectionLines.some((l) => startsAtMargin(l) && startsWithBadge(l) && hasMoney(l));
    const rows = clusterRows(sectionLines, (l) =>
      startsAtMargin(l) && hasMoney(l) && (!hasBadgeAnchors || startsWithBadge(l)),
    );
    const entries: BudgetFlagEntry[] = [];
    for (const row of rows) {
      const entry = parseBudgetFlagRow(row.anchor, row.segs);
      if (entry) entries.push(entry);
    }

    concerns.push({ level, items, entries, boundingBoxes: sectionBB });
  }

  // Missing Line Items
  let missingLineItems = "";
  let missingItems: MissingLineItem[] = [];
  const missingIdx = body.findIndex((l) => /^Missing Line Items$/i.test(l.fullText.trim()));
  if (missingIdx >= 0) {
    const missingLine = body[missingIdx];
    bb.missingLineItems = toBBox(missingLine.segments[0], missingLine);
    const textLines: string[] = [];
    for (let j = missingIdx + 1; j < body.length; j++) {
      const text = body[j].fullText.trim();
      if (!text) continue;
      textLines.push(text);
      if (!bb.missingLineItemsText) {
        bb.missingLineItemsText = toBBox(body[j].segments[0], body[j]);
      }
    }
    missingLineItems = textLines.join(" ");
    missingItems = parseMissingLineItems(body.slice(missingIdx + 1));
  }

  return { concerns, missingLineItems, missingItems, boundingBoxes: bb };
}

/**
 * One logical row of a concern table: [badge] [item] [budget] [expected] [diff] [notes].
 * Works on whitespace tokens because pdf text runs merge cells unpredictably
 * ("LOW Countertops", "$1,500 -$500", "+$3,000 if this is just for framing").
 */
function parseBudgetFlagRow(line: TextLine, segs: Seg[]): BudgetFlagEntry | null {
  const ordered = sortReading(segs);
  if (/^Flag\s+Item\s+Budget/i.test(ordered.map((s) => s.text).join(" "))) return null;

  const tokens: { text: string; seg: Seg; order: number }[] = [];
  for (const seg of ordered) {
    for (const t of seg.text.split(/\s+/)) if (t) tokens.push({ text: t, seg, order: 0 });
  }
  if (tokens.length === 0) return null;

  const bb: Record<string, BoundingBox> = {};
  let i = 0;
  let flag: string | null = null;
  const two = tokens.length > 1 ? `${tokens[0].text} ${tokens[1].text}` : "";
  if (two && FLAG_BADGE.test(two)) {
    flag = two.toUpperCase();
    bb.flag = toBBox(tokens[0].seg, line);
    i = 2;
  } else if (FLAG_BADGE.test(tokens[0].text)) {
    flag = tokens[0].text.toUpperCase();
    bb.flag = toBBox(tokens[0].seg, line);
    i = 1;
  }

  const isValueToken = (t: string) => parseSignedCurrency(t) !== null || /^N\/A$/i.test(t);

  // Item name: tokens up to the first Budget value
  const nameParts: string[] = [];
  while (i < tokens.length && !isValueToken(tokens[i].text)) {
    nameParts.push(tokens[i].text);
    if (!bb.item) bb.item = toBBox(tokens[i].seg, line);
    i++;
  }

  // Budget, Expected, Diff: each a currency or N/A; everything after is Notes
  const values: (number | null)[] = [];
  const slots = ["budget", "expected", "diff"];
  while (i < tokens.length && values.length < 3 && isValueToken(tokens[i].text)) {
    values.push(parseSignedCurrency(tokens[i].text));
    bb[slots[values.length - 1]] = toBBox(tokens[i].seg, line);
    i++;
  }
  // Notes are free text: read them top-to-bottom, left-to-right, not by column.
  const notesTokens = [...tokens.slice(i)].sort((a, b) => (Math.abs(a.seg.y - b.seg.y) > 3 ? a.seg.y - b.seg.y : a.seg.x - b.seg.x));
  const notes = notesTokens.map((t) => t.text).join(" ").replace(/^-\s*/, "").replace(/\s+-\s*$/, "").trim();

  const item = nameParts.join(" ").trim();
  if (!item || values.length === 0) return null;

  const budget = values[0] ?? null;
  const expected = values[1] ?? null;
  // Diff is Budget − Expected. Recompute it when both are known: the printed
  // sign is sometimes lost when the cell wraps onto its own line.
  const diff = budget !== null && expected !== null ? budget - expected : values[2] ?? null;
  return {
    flag,
    item,
    budget,
    expected,
    diff,
    notes,
    boundingBoxes: bb,
  };
}

/**
 * "Missing Line Items" table. Rows start at the left margin; a wrapped
 * Comments cell spills onto neighbouring lines at the Comments column (x≥290),
 * sometimes ABOVE the row because the cell is vertically centred, so comment
 * fragments are attached to the nearest row by y.
 */
function parseMissingLineItems(body: TextLine[]): MissingLineItem[] {
  const HEADER = /^(Expected Costs|Missing Item|Low|High|Expected|SQFT|Flags|Comments|\$ \/)/i;
  type Row = { line: TextLine; item: MissingLineItem };
  const rows: Row[] = [];
  const fragments: { y: number; text: string }[] = [];

  for (const line of body) {
    const segs = lineSegs(line);
    if (segs.length === 0) continue;
    const first = segs[0];
    const text = segs.map((s) => s.text).join(" ");

    if (first.x < 60) {
      if (/^Total\b/i.test(first.text)) break;
      if (HEADER.test(first.text) || /^No items/i.test(first.text)) continue;
      // A real row always carries at least one dollar amount
      if (!/\$\d/.test(text)) continue;

      // Item name = everything before the first currency value
      const firstMoneyIdx = text.search(/[+-]?\$[\d,]+(?:\.\d+)?/);
      const item = (firstMoneyIdx >= 0 ? text.slice(0, firstMoneyIdx) : text).trim();
      const rest = firstMoneyIdx >= 0 ? text.slice(firstMoneyIdx) : "";
      const money = Array.from(rest.matchAll(/[+-]?\$[\d,]+(?:\.\d+)?/g), (m) => parseSignedCurrency(m[0]));
      const badgeMatch = rest.match(/\b(MISSING|HIGH|LOW|VERY HIGH|VERY LOW)\b/);
      const comments = badgeMatch ? rest.slice(badgeMatch.index! + badgeMatch[0].length).trim() : "";

      const bb: Record<string, BoundingBox> = { item: toBBox(first, line) };
      rows.push({
        line,
        item: {
          item,
          low: money[0] ?? null,
          high: money[1] ?? null,
          expected: money[2] ?? null,
          perSqft: money[3] ?? null,
          flag: badgeMatch ? badgeMatch[1].toUpperCase() : null,
          comments,
          boundingBoxes: bb,
        },
      });
    } else if (first.x >= 290 && !/\$/.test(text) && !HEADER.test(first.text)) {
      fragments.push({ y: line.y, text });
    }
  }

  // Attach wrapped comment fragments to the closest row.
  for (const frag of fragments) {
    let best: Row | null = null;
    let bestDy = Infinity;
    for (const row of rows) {
      const dy = Math.abs(row.line.y - frag.y);
      if (dy < bestDy) {
        bestDy = dy;
        best = row;
      }
    }
    if (!best || bestDy > 14) continue;
    best.item.comments = frag.y < best.line.y
      ? `${frag.text} ${best.item.comments}`.trim()
      : `${best.item.comments} ${frag.text}`.trim();
  }

  return rows.map((r) => r.item);
}

// ── Budget Line Items (Page 19) ───────────────────────────────────────────────

/**
 * Column boundaries, derived from the table's own header row because the
 * layout drifted over the years. Header text is centred in its column while
 * cell text is left-aligned, so the boundary between two columns is the
 * midpoint of their header positions.
 */
interface LineItemColumns {
  descStart: number;
  catStart: number;
  moneyStart: number;
}

const DEFAULT_COLUMNS: LineItemColumns = { descStart: 168, catStart: 274, moneyStart: 347 };

function detectLineItemColumns(headerLine: TextLine | undefined): LineItemColumns {
  if (!headerLine) return DEFAULT_COLUMNS;
  const segs = lineSegs(headerLine);
  const find = (re: RegExp) => segs.find((s) => re.test(s.text));
  const items = find(/^Budget Items/i);
  const desc = find(/^Description/i);
  const cat = find(/^Categories/i);
  const money = find(/^HR\b/i) ?? segs.find((s) => /\bHR\b/.test(s.text) && s !== cat && s !== desc);
  if (!items || !desc || !cat || !money) return DEFAULT_COLUMNS;
  // Single merged header segment ("Budget Items Description Categories HR …") carries no column positions.
  if (items === desc || desc === cat || cat === money) return DEFAULT_COLUMNS;
  return {
    descStart: (items.x + desc.x) / 2,
    catStart: (desc.x + cat.x) / 2,
    moneyStart: (cat.x + money.x) / 2,
  };
}

const ROW_NUMBER = /^(\d{1,3})(?:\s+(.*))?$/;

function isNumberedRow(line: TextLine): boolean {
  const first = line.segments.find((s) => s.text.trim());
  if (!first || first.x >= 45) return false;
  const m = first.text.trim().match(ROW_NUMBER);
  // "1" alone, or "12 HIGH Paint …"; but never a bare number with nothing else on the line
  return !!m && (line.segments.length > 1 || !!m[2]);
}

function hasMoney(line: TextLine): boolean {
  return line.segments.some((s) => /\$\d/.test(s.text));
}

function isTotalRow(line: TextLine): boolean {
  return /^Total\b/i.test(line.fullText.trim()) && hasMoney(line);
}

/** Lines of the Budget Line Items table: the title page plus any continuation pages up to the Total row. */
function collectLineItemLines(lines: TextLine[], headerIdx: number): TextLine[] {
  const header = lines[headerIdx];
  const out: TextLine[] = [];
  const maxPage = Math.max(...lines.map((l) => l.page));
  for (let page = header.page; page <= maxPage; page++) {
    const pageLines = lines.filter((l) => l.page === page && !isHeaderOrFooter(l) && (page !== header.page || l.y > header.y));
    if (page !== header.page) {
      // A continuation page has no title; stop at the first page that is not table rows.
      const looksLikeTable = pageLines.some((l) => (isNumberedRow(l) && hasMoney(l)) || isTotalRow(l));
      if (!looksLikeTable) break;
    }
    out.push(...pageLines);
    if (pageLines.some(isTotalRow)) break;
  }
  return out;
}

function parseBudgetLineItems(lines: TextLine[]): BudgetLineItems {
  const headerIdx = lines.findIndex((l) => /^Budget Line Items$/i.test(l.fullText.trim()));

  const bb: Record<string, BoundingBox> = {};
  if (headerIdx < 0) {
    return { categories: [], totalHR: null, totalDM: null, totalUP: null, totalRC: null, totalSoft: null, grandTotal: null, boundingBoxes: bb };
  }
  const hl = lines[headerIdx];
  bb.title = toBBox(hl.segments[0], hl);

  const body = collectLineItemLines(lines, headerIdx);
  const columnHeader = body.find((l) => /^Budget Items\b/i.test(l.fullText.trim()));
  const cols = detectLineItemColumns(columnHeader);

  // Anchors: numbered item rows, category rows (money, no number) and the Total row.
  const rows = clusterRows(
    body.filter((l) => l !== columnHeader),
    (l) => isNumberedRow(l) || hasMoney(l),
  );

  const categories: BudgetCategory[] = [];
  let currentCategory: BudgetCategory | null = null;

  let totalHR: number | null = null;
  let totalDM: number | null = null;
  let totalUP: number | null = null;
  let totalRC: number | null = null;
  let totalSoft: number | null = null;
  let grandTotal: number | null = null;

  for (const { anchor, segs } of rows) {
    const ordered = sortReading(segs);

    // Split the row into columns. Money tokens are taken from the money
    // columns and from the Categories column (a run like "Exterior Doors
    // $10,000" happens when the cells touch); text columns keep the rest.
    const nameSegs: Seg[] = [];
    const descSegs: Seg[] = [];
    const catSegs: Seg[] = [];
    const money: { value: number; seg: Seg }[] = [];
    let numberSeg: Seg | null = null;
    let num: number | null = null;

    for (const seg of ordered) {
      if (!numberSeg && seg.x < 45) {
        const m = seg.text.match(ROW_NUMBER);
        if (m) {
          numberSeg = seg;
          num = parseInt(m[1], 10);
          if (m[2]) nameSegs.push({ ...seg, text: m[2] });
          continue;
        }
      }
      if (seg.x >= cols.moneyStart) {
        for (const t of seg.text.split(/\s+/)) {
          const v = parseSignedCurrency(t);
          if (v !== null) money.push({ value: v, seg });
        }
      } else if (seg.x >= cols.catStart) {
        const words: string[] = [];
        for (const t of seg.text.split(/\s+/)) {
          const v = MONEY_TOKEN.test(t) ? parseSignedCurrency(t) : null;
          if (v !== null) money.push({ value: v, seg });
          else words.push(t);
        }
        if (words.length) catSegs.push({ ...seg, text: words.join(" ") });
      } else if (seg.x >= cols.descStart) {
        descSegs.push(seg);
      } else {
        nameSegs.push(seg);
      }
    }

    const values = money.map((m) => m.value);
    const [hr = null, dm = null, up = null, rc = null, soft = null, total = null] = values;
    const lastMoney = money[money.length - 1];

    if (isTotalRow(anchor)) {
      [totalHR, totalDM, totalUP, totalRC, totalSoft, grandTotal] = [hr, dm, up, rc, soft, total];
      const totalSeg = ordered.find((s) => /^Total\b/i.test(s.text));
      if (totalSeg) bb.total = toBBox(totalSeg, anchor);
      if (lastMoney) bb.grandTotal = toBBox(lastMoney.seg, anchor);
      continue;
    }

    if (num !== null) {
      let name = joinColumn(nameSegs);
      let flag: string | null = null;
      // A leading badge is the report's verdict on the line; lines it accepts
      // carry a green check icon instead, which has no text.
      const badge = name.match(LEADING_BADGE);
      if (badge) {
        flag = badge[1].toUpperCase();
        name = name.slice(badge[0].length).trim();
      }

      const itemBB: Record<string, BoundingBox> = {};
      if (numberSeg) itemBB.number = toBBox(numberSeg, anchor);
      if (nameSegs[0]) itemBB.name = toBBox(nameSegs[0], anchor);
      if (descSegs[0]) itemBB.description = toBBox(descSegs[0], anchor);
      if (catSegs[0]) itemBB.category = toBBox(catSegs[0], anchor);
      if (lastMoney) itemBB.total = toBBox(lastMoney.seg, anchor);

      const item: BudgetLineItem = {
        number: num,
        name,
        description: joinColumn(descSegs),
        category: joinColumn(catSegs),
        flag,
        hr, dm, up, rc, soft, total,
        boundingBoxes: itemBB,
      };
      if (!currentCategory) {
        currentCategory = { name: "", hr: null, dm: null, up: null, rc: null, soft: null, total: null, items: [], boundingBoxes: {} };
        categories.push(currentCategory);
      }
      currentCategory.items.push(item);
    } else if (values.length > 0) {
      // Category row: has dollar values but no leading number
      const catBB: Record<string, BoundingBox> = {};
      const nameSeg = nameSegs[0] ?? descSegs[0];
      if (nameSeg) catBB.name = toBBox(nameSeg, anchor);
      if (lastMoney) catBB.total = toBBox(lastMoney.seg, anchor);

      currentCategory = {
        name: joinColumn([...nameSegs, ...descSegs]),
        hr, dm, up, rc, soft, total,
        items: [],
        boundingBoxes: catBB,
      };
      categories.push(currentCategory);
    }
  }

  return {
    categories,
    totalHR, totalDM, totalUP, totalRC, totalSoft, grandTotal,
    boundingBoxes: bb,
  };
}
