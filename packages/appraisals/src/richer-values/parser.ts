import { extractLines, UnrecognizedFormatError, toBBox } from "@parseo/shared";
import type { TextLine, BoundingBox } from "@parseo/shared";
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

  // Determine value column boundaries from the header (Min, Partial, Full, Best).
  const minSeg = headerLine?.segments.find((s) => s.text.trim() === "Min");
  const bestSeg = headerLine?.segments.find((s) => s.text.trim() === "Best");
  const valXMin = minSeg ? minSeg.x - 15 : 75;
  const valXMax = bestSeg ? bestSeg.x + bestSeg.width + 15 : 290;

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

  return {
    min: buildStrategy(0),
    partial: buildStrategy(1),
    full: buildStrategy(2),
    best: buildStrategy(3),
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

  // Parse comp rows
  let currentGroup = "";
  const comparables: Comparable[] = [];

  for (const line of tableLines) {
    const firstSeg = line.segments[0]?.text.trim();

    // Condition group header: "#" + group name
    if (firstSeg === "#" && line.segments.length >= 2) {
      const groupName = line.segments[1]?.text.trim();
      if (CONDITION_GROUPS.some((g) => groupName === g)) {
        currentGroup = groupName;
      }
      continue;
    }

    // Skip subject and non-data lines
    if (firstSeg === "S" || firstSeg === "#") continue;
    if (!/^\d+$/.test(firstSeg ?? "")) continue;

    const comp = parseCompRow(line, parseInt(firstSeg!, 10), currentGroup);
    if (comp) comparables.push(comp);
  }

  return { title: sectionTitle, comparables };
}

function parseCompRow(line: TextLine, num: number, group: string): Comparable | null {
  const bb: Record<string, BoundingBox> = {};

  // Address: segments with x < 155 (after the # segment)
  const addrSegs = line.segments.filter((s) => s.x > 40 && s.x < 155);
  const address = addrSegs.map((s) => s.text.trim()).join(" ");
  if (addrSegs[0]) bb.address = toBBox(addrSegs[0], line);

  // Data: segments with x >= 150 — concatenate and parse
  const dataSegs = line.segments.filter((s) => s.x >= 150);
  const dataText = dataSegs.map((s) => s.text.trim()).join(" ");

  // Parse numeric data after address.
  // Pattern: [Type] sqft bd bth year stories lot dist [flags] [grg] COE SP $/sqft C TTS [score]
  // Type is optional (e.g., "C", "TH", "SF", "QP") — strip it if present
  const stripped = dataText.replace(/^[A-Z]{1,3}\s+/, "");
  const m = stripped.match(
    /^([\d,]+)\s+(\d+)\s+([\d.]+)\s+(\d{4})\s+([\d.]+)\s+([\d.]+|unkn)\s+([\d.]+)\s+(.+)$/
  );
  if (!m) return null;

  const sqft = parseInt(m[1].replace(/,/g, ""), 10);
  const beds = parseInt(m[2], 10);
  const baths = parseFloat(m[3]);
  const yearBuilt = parseInt(m[4], 10);
  const stories = parseFloat(m[5]);
  const lot = m[6] === "unkn" ? null : parseFloat(m[6]);
  const dist = parseFloat(m[7]);
  const tail = m[8];

  // Parse the tail: [flags] [grg] COE SP $/sqft C TTS [score]
  const tailMatch = tail.match(
    /^(\d+)?\s*(\d+)?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s+\$([\d,]+)\s+\$(\d+)\s+([\d.]+)\s+(\d+)\s*([\d.]+)?$/
  );

  let flags: number | null = null;
  let garage: number | null = null;
  let closeOfEscrow = "";
  let salePrice: number | null = null;
  let pricePerSqft: number | null = null;
  let condition: number | null = null;
  let timeToSale: number | null = null;
  let score: number | null = null;

  if (tailMatch) {
    const pre1 = tailMatch[1];
    const pre2 = tailMatch[2];
    if (pre2 !== undefined) {
      flags = parseInt(pre1!, 10);
      garage = parseInt(pre2, 10);
    } else if (pre1 !== undefined) {
      garage = parseInt(pre1, 10);
    }
    closeOfEscrow = tailMatch[3];
    salePrice = parseInt(tailMatch[4].replace(/,/g, ""), 10);
    pricePerSqft = parseInt(tailMatch[5], 10);
    condition = parseFloat(tailMatch[6]);
    timeToSale = parseInt(tailMatch[7], 10);
    score = tailMatch[8] !== undefined ? parseFloat(tailMatch[8]) : null;
  }

  // Attach bounding boxes — map each segment to a field by x-coordinate.
  // Segments are often merged, so we use the x position to determine which
  // field the segment primarily represents.
  for (const seg of dataSegs) {
    const t = seg.text.trim();
    const x = seg.x;

    if (x < 200 && !bb.sqft) {
      // First data segment covers sqft, beds, baths, yearBuilt (often merged)
      const box = toBBox(seg, line);
      bb.sqft = box;
      bb.beds = box;
      bb.baths = box;
      bb.yearBuilt = box;
    } else if (x >= 250 && x < 295 && !bb.stories) {
      bb.stories = toBBox(seg, line);
    } else if (x >= 285 && x < 325 && !bb.lot) {
      bb.lot = toBBox(seg, line);
    } else if (x >= 325 && x < 380 && /^\d/.test(t) && !bb.distance) {
      bb.distance = toBBox(seg, line);
    } else if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t) && !bb.closeOfEscrow) {
      bb.closeOfEscrow = toBBox(seg, line);
    } else if (/^\$[\d,]+$/.test(t) && t.length > 5 && !bb.salePrice) {
      bb.salePrice = toBBox(seg, line);
    } else if (/^\$\d+$/.test(t) && !bb.pricePerSqft) {
      bb.pricePerSqft = toBBox(seg, line);
    } else if (x >= 495 && x < 545 && /^[\d.]+$/.test(t) && !bb.condition) {
      bb.condition = toBBox(seg, line);
    } else if (x >= 520 && x < 575 && /^\d+$/.test(t) && !bb.timeToSale) {
      bb.timeToSale = toBBox(seg, line);
    } else if (x >= 555 && /^[\d.]+$/.test(t) && !bb.score) {
      bb.score = toBBox(seg, line);
    }
  }

  // For merged segments (e.g., "10/3/25 $750,000"), try to pick up SP from merged text
  if (!bb.salePrice) {
    const spSeg = dataSegs.find((s) => /\$[\d,]{4,}/.test(s.text));
    if (spSeg) bb.salePrice = toBBox(spSeg, line);
  }

  return {
    number: num,
    address,
    conditionGroup: group,
    sqft,
    beds,
    baths,
    yearBuilt,
    stories,
    lot,
    distance: dist,
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

// ── Budget Flags (Page 18) ────────────────────────────────────────────────────

const CONCERN_LEVELS = [
  "Significant Concerns",
  "Medium Concerns",
  "Moderate Concerns",
  "Cautionary Concerns",
];

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
    for (let j = levelIdx + 1; j < body.length; j++) {
      const text = body[j].fullText.trim();
      if (CONCERN_LEVELS.includes(text) || /^Missing Line Items$/i.test(text)) break;
      if (text && !/^No line items flagged\.?$/i.test(text) && !/^Specific Line Item/i.test(text)) {
        items.push(text);
        sectionBB[`item${items.length}`] = toBBox(body[j].segments[0], body[j]);
      }
    }

    concerns.push({ level, items, boundingBoxes: sectionBB });
  }

  // Missing Line Items
  let missingLineItems = "";
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
  }

  return { concerns, missingLineItems, boundingBoxes: bb };
}

// ── Budget Line Items (Page 19) ───────────────────────────────────────────────

function parseDollarValues(segments: { text: string; x: number; width: number; height: number }[]): number[] {
  const values: number[] = [];
  // Only look at segments in the dollar columns (x >= 370)
  for (const seg of segments) {
    if (seg.x < 370) continue;
    const matches = seg.text.match(/\$[\d,]+/g);
    if (matches) {
      for (const m of matches) {
        values.push(parseInt(m.replace(/[$,]/g, ""), 10));
      }
    }
  }
  return values;
}

function parseBudgetLineItems(lines: TextLine[]): BudgetLineItems {
  const headerIdx = lines.findIndex((l) => /^Budget Line Items$/i.test(l.fullText.trim()));
  const headerPage = headerIdx >= 0 ? lines[headerIdx].page : -1;

  const body = headerIdx >= 0
    ? lines.filter((l) => l.page === headerPage && !isHeaderOrFooter(l) && l.y > lines[headerIdx].y)
    : [];

  const bb: Record<string, BoundingBox> = {};
  if (headerIdx >= 0) {
    const hl = lines[headerIdx];
    bb.title = toBBox(hl.segments[0], hl);
  }

  const categories: BudgetCategory[] = [];
  let currentCategory: BudgetCategory | null = null;

  let totalHR: number | null = null;
  let totalDM: number | null = null;
  let totalUP: number | null = null;
  let totalRC: number | null = null;
  let totalSoft: number | null = null;
  let grandTotal: number | null = null;

  for (const line of body) {
    const text = line.fullText.trim();

    // Skip the column header row
    if (/^Budget Items\b/i.test(text)) continue;

    // Check if this is a Total row
    if (/^Total\b/.test(text) && line.segments.some((s) => /\$/.test(s.text))) {
      const vals = parseDollarValues(line.segments);
      [totalHR, totalDM, totalUP, totalRC, totalSoft, grandTotal] =
        vals.map((v) => v ?? null);
      const totalSeg = line.segments.find((s) => /Total/.test(s.text));
      if (totalSeg) bb.total = toBBox(totalSeg, line);
      const lastSeg = line.segments[line.segments.length - 1];
      if (lastSeg) bb.grandTotal = toBBox(lastSeg, line);
      continue;
    }

    // Check if this is a numbered item row.
    // Case 1: first segment is just a number (e.g., "1" at x~32)
    // Case 2: number and name merged (e.g., "1 Dumpster / Debris Removal" at x~31)
    const firstSeg = line.segments[0];
    const separateNum = firstSeg && firstSeg.x < 50 && /^\d+$/.test(firstSeg.text.trim());
    const mergedNum = firstSeg && firstSeg.x < 50 && /^\d+\s+\S/.test(firstSeg.text.trim());
    const isItemRow = separateNum || mergedNum;

    if (isItemRow) {
      const itemBB: Record<string, BoundingBox> = {};
      let num: number;
      let name: string;

      if (separateNum) {
        num = parseInt(firstSeg.text.trim(), 10);
        itemBB.number = toBBox(firstSeg, line);
        const nameSeg = line.segments.find((s) => s.x >= 55 && s.x < 200);
        name = nameSeg?.text.trim() ?? "";
        if (nameSeg) itemBB.name = toBBox(nameSeg, line);
      } else {
        // Number and name merged in one segment
        const match = firstSeg.text.trim().match(/^(\d+)\s+(.+)$/);
        num = parseInt(match![1], 10);
        name = match![2].trim();
        itemBB.number = toBBox(firstSeg, line);
        itemBB.name = toBBox(firstSeg, line);
      }

      // Description segment at x~258
      const descSeg = line.segments.find((s) => s.x >= 200 && s.x < 370);
      const description = descSeg?.text.trim() ?? "";
      if (descSeg) itemBB.description = toBBox(descSeg, line);

      const vals = parseDollarValues(line.segments);
      const [hr = null, dm = null, up = null, rc = null, soft = null, total = null] =
        vals.map((v) => v ?? null);

      // Bounding box for total (last segment)
      const lastSeg = line.segments[line.segments.length - 1];
      if (lastSeg && /\$/.test(lastSeg.text)) itemBB.total = toBBox(lastSeg, line);

      const item: BudgetLineItem = {
        number: num,
        name,
        description,
        hr, dm, up, rc, soft, total,
        boundingBoxes: itemBB,
      };

      if (currentCategory) {
        currentCategory.items.push(item);
      }
    } else if (line.segments.some((s) => /\$/.test(s.text))) {
      // Category row: has dollar values but no leading number
      const catBB: Record<string, BoundingBox> = {};
      const catNameSeg = line.segments.find((s) => s.x < 200);
      const catName = catNameSeg?.text.trim() ?? "";
      if (catNameSeg) catBB.name = toBBox(catNameSeg, line);

      const vals = parseDollarValues(line.segments);
      const [hr = null, dm = null, up = null, rc = null, soft = null, total = null] =
        vals.map((v) => v ?? null);

      const lastSeg = line.segments[line.segments.length - 1];
      if (lastSeg && /\$/.test(lastSeg.text)) catBB.total = toBBox(lastSeg, line);

      currentCategory = {
        name: catName,
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
