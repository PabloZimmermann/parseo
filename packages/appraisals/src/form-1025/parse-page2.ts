import { toBBox } from "@parseo/shared";
import type { TextLine, BoundingBox } from "@parseo/shared";
import { resolveCheckbox } from "../form-1004mc/extract-checkboxes.js";
import type { CheckedPosition } from "../form-1004mc/extract-checkboxes.js";
import type {
  ComparableRentalDataSection,
  RentalComparable,
  RentalUnit,
  SubjectRentScheduleSection,
  RentScheduleUnit,
  PriorSaleHistorySection,
  PriorSaleEntry,
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
    .replace(/\$/g, "")
    .trim();
}

function colNum(line: TextLine | undefined, min: number, max: number): number | null {
  const t = colText(line, min, max);
  const m = t.match(/-?[\d,]+(?:\.\d+)?/);
  return m ? parseNum(m[0]) : null;
}

// ── Comparable Rental Data (Page 2) ──────────────────────────────────────

const RENTAL_SUBJECT = { min: 140, max: 211 };
const RENTAL_COLS = [
  { min: 212, max: 322, rentWindow: { min: 295, max: 322 } },
  { min: 322, max: 431, rentWindow: { min: 405, max: 431 } },
  { min: 431, max: 545, rentWindow: { min: 515, max: 545 } },
];
// Rent-control Yes/No label x-positions per column (subject + 3 comps)
const RENT_CONTROL_OPTS = [
  [{ x: 162, label: "Yes" }, { x: 186, label: "No" }],
  [{ x: 225, label: "Yes" }, { x: 248, label: "No" }],
  [{ x: 334, label: "Yes" }, { x: 357, label: "No" }],
  [{ x: 443, label: "Yes" }, { x: 466, label: "No" }],
];

function parseRentalColumn(
  lines: TextLine[],
  checked: CheckedPosition[],
  number: number,
  col: { min: number; max: number },
  rentWindow: { min: number; max: number } | null,
  rentControlOpts: { x: number; label: string }[],
): RentalComparable {
  const bb: Record<string, BoundingBox> = {};

  const addrLine = findLine(lines, /^Address/i);
  let address = colText(addrLine, col.min, col.max);
  if (number === 0 && addrLine) {
    // Subject address is embedded in the label segment "Address 9704 ..."
    const seg = addrLine.segments.find((s) => /^Address\s/i.test(s.text));
    if (seg) address = seg.text.replace(/^Address\s+/i, "").trim();
  }
  if (addrLine) {
    const idx = lines.indexOf(addrLine);
    const cityLine = lines[idx + 1];
    const city = number === 0
      ? (cityLine?.segments.find((s) => s.x < RENTAL_SUBJECT.max)?.text.trim() ?? "")
      : colText(cityLine, col.min, col.max);
    if (city) address = `${address}, ${city}`;
    if (addrLine.segments[0]) bb.address = toBBox(addrLine.segments[0], addrLine);
  }

  const rentControlLine = findLine(lines, /^Rent Control/i);
  const rentControl = rentControlLine ? resolveCheckbox(checked, rentControlLine.y, rentControlOpts) : "";

  const units: RentalUnit[] = [];
  if (rentWindow) {
    for (let u = 1; u <= 4; u++) {
      const uLine = findLine(lines, new RegExp(`^Unit # ${u}\\b`, "i"));
      if (!uLine) continue;
      const rent = colNum(uLine, rentWindow.min, rentWindow.max);
      if (rent !== null) {
        units.push({ roomCountTotal: null, bedrooms: null, baths: null, sizeSqft: null, monthlyRent: rent });
      }
    }
  }

  return {
    number,
    address,
    proximityToSubject: colText(findLine(lines, /^Proximity to Subject/i), col.min, col.max),
    currentMonthlyRent: colNum(findLine(lines, /^Current Monthly Rent/i), col.min, col.max),
    rentPerSqft: (() => {
      const l = findLine(lines, /^Rent\/Gross Bldg\. Area/i);
      const t = colText(l, col.min, col.max);
      const m = t.match(/([\d.]+)\s*sq/i);
      return m ? parseNum(m[1]) : null;
    })(),
    rentControl,
    dataSources: colText(findLine(lines, /^Data Source\(s\)/i), col.min, col.max),
    dateOfLease: colText(findLine(lines, /^Date of Lease/i), col.min, col.max),
    location: colText(findLine(lines, /^Location\b/i), col.min, col.max),
    actualAge: colNum(findLine(lines, /^Actual Age/i), col.min, col.max),
    condition: colText(findLine(lines, /^Condition\b/i), col.min, col.max),
    grossBuildingArea: colNum(findLine(lines, /^Gross Building Area/i), col.min, col.max),
    units,
    utilitiesIncluded: colText(findLine(lines, /^Utilities Included/i), col.min, col.max),
    xtraAmenities: colText(findLine(lines, /^X'tra Am+enities/i), col.min, col.max),
    type: colText(findLine(lines, /^Type\b/i), col.min, col.max),
    boundingBoxes: bb,
  };
}

export function parseComparableRentalDataSection(lines: TextLine[], checked: CheckedPosition[]): ComparableRentalDataSection {
  const bb: Record<string, BoundingBox> = {};

  const subject = parseRentalColumn(lines, checked, 0, RENTAL_SUBJECT, null, RENT_CONTROL_OPTS[0]);
  const comparables: RentalComparable[] = [];
  for (let i = 0; i < 3; i++) {
    comparables.push(parseRentalColumn(lines, checked, i + 1, RENTAL_COLS[i], RENTAL_COLS[i].rentWindow, RENT_CONTROL_OPTS[i + 1]));
  }

  const analysisLine = findLine(lines, /^Analysis of rental data/i);
  let analysis = "";
  if (analysisLine) {
    const idx = lines.indexOf(analysisLine);
    const parts = [analysisLine.fullText.trim()];
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^Rent Schedule:/i.test(lines[i].fullText)) break;
      const t = lines[i].fullText.trim();
      if (t) parts.push(t);
    }
    // Drop the printed field label, which ends at "...rental concessions, etc.)"
    analysis = parts.join(" ").replace(/^.*?etc\.\)\s*/is, "").trim();
    if (analysisLine.segments[0]) bb.analysis = toBBox(analysisLine.segments[0], analysisLine);
  }

  return { subject, comparables, analysis, boundingBoxes: bb };
}

// ── Subject Rent Schedule (Page 2) ───────────────────────────────────────

const RS_COLS = {
  begin: { min: 122, max: 186 },
  end: { min: 186, max: 237 },
  actualUnfurnished: { min: 237, max: 294 },
  actualFurnished: { min: 294, max: 350 },
  actualTotal: { min: 350, max: 396 },
  marketUnfurnished: { min: 396, max: 453 },
  marketFurnished: { min: 453, max: 509 },
  marketTotal: { min: 509, max: 545 },
};

export function parseSubjectRentScheduleSection(lines: TextLine[]): SubjectRentScheduleSection {
  const bb: Record<string, BoundingBox> = {};

  const units: RentScheduleUnit[] = [];
  for (let u = 1; u <= 4; u++) {
    // Rows are labelled with a lone unit number near x~95
    const line = lines.find((l) => {
      const first = l.segments[0];
      return first && Math.abs(first.x - 95) < 8 && first.text.trim() === String(u);
    });
    if (!line) continue;
    const entry: RentScheduleUnit = {
      unit: u,
      leaseBeginDate: colText(line, RS_COLS.begin.min, RS_COLS.begin.max),
      leaseEndDate: colText(line, RS_COLS.end.min, RS_COLS.end.max),
      actualRentUnfurnished: colNum(line, RS_COLS.actualUnfurnished.min, RS_COLS.actualUnfurnished.max),
      actualRentFurnished: colNum(line, RS_COLS.actualFurnished.min, RS_COLS.actualFurnished.max),
      actualTotalRent: colNum(line, RS_COLS.actualTotal.min, RS_COLS.actualTotal.max),
      marketRentUnfurnished: colNum(line, RS_COLS.marketUnfurnished.min, RS_COLS.marketUnfurnished.max),
      marketRentFurnished: colNum(line, RS_COLS.marketFurnished.min, RS_COLS.marketFurnished.max),
      marketTotalRent: colNum(line, RS_COLS.marketTotal.min, RS_COLS.marketTotal.max),
    };
    units.push(entry);
  }

  const actualRentLine = findLine(lines, /Total Actual Monthly Rent/i);
  const totalActualMonthlyRent = (() => {
    const seg = actualRentLine?.segments.find((s) => /Total Actual Monthly Rent/i.test(s.text));
    if (!seg) return null;
    const m = seg.text.match(/Total Actual Monthly Rent\s*\$?\s*([\d,]+)/i);
    return m ? parseNum(m[1]) : colNum(actualRentLine, 350, 396);
  })();

  const grossRentLine = findLine(lines, /Total Gross Monthly Rent/i);
  const totalGrossMonthlyRent = grossRentLine ? colNum(grossRentLine, 509, 545) : null;

  const actualIncomeLine = findLine(lines, /Total Actual Monthly Income/i);
  const totalActualMonthlyIncome = actualIncomeLine ? colNum(actualIncomeLine, 350, 396) : null;

  const estIncomeLine = findLine(lines, /Total Estimated Monthly Income/i);
  const totalEstimatedMonthlyIncome = estIncomeLine ? colNum(estIncomeLine, 509, 545) : null;

  const commentLine = findLine(lines, /Comment on lease data/i);
  let commentOnLeaseData = "";
  if (commentLine) {
    const seg = commentLine.segments.find((s) => s.x > 140 && s.x < 220);
    if (seg) commentOnLeaseData = seg.text.trim();
    const idx = lines.indexOf(commentLine);
    const next = lines[idx + 1];
    const nextSeg = next?.segments.find((s) => s.x > 140 && s.x < 220);
    if (nextSeg) commentOnLeaseData += " " + nextSeg.text.trim();
    commentOnLeaseData = commentOnLeaseData.trim();
  }

  const commentsLine = findLine(lines, /^Comments on actual or estimated rents/i);
  let comments = "";
  if (commentsLine) {
    const idx = lines.indexOf(commentsLine);
    const valueSeg = commentsLine.segments.find((s) => s.x > 320);
    const parts: string[] = [];
    if (valueSeg) parts.push(valueSeg.text.trim());
    for (let i = idx + 1; i < lines.length; i++) {
      if (/did not research the sale/i.test(lines[i].fullText)) break;
      const t = lines[i].fullText.trim();
      if (t) parts.push(t);
    }
    comments = parts.join(" ").trim();
  }

  return {
    units, commentOnLeaseData, totalActualMonthlyRent, totalGrossMonthlyRent,
    totalActualMonthlyIncome, totalEstimatedMonthlyIncome, comments, boundingBoxes: bb,
  };
}

// ── Prior Sale History (Page 2 bottom) ───────────────────────────────────

const PS_COLS = [
  { min: 165, max: 265 }, // Subject
  { min: 265, max: 357 }, // Comp 1
  { min: 357, max: 448 }, // Comp 2
  { min: 448, max: 545 }, // Comp 3
];

function didOrDidNot(line: TextLine | undefined, checked: CheckedPosition[], didX: number, didNotX: number): string {
  if (!line) return "";
  return resolveCheckbox(checked, line.y, [
    { x: didX, label: "did" },
    { x: didNotX, label: "did not" },
  ]);
}

export function parsePriorSaleHistorySection(lines: TextLine[], checked: CheckedPosition[]): PriorSaleHistorySection {
  const bb: Record<string, BoundingBox> = {};

  const subjRevealLine = findLine(lines, /reveal any prior sales.*subject property/i);
  const compRevealLine = findLine(lines, /reveal any prior sales.*comparable sales/i);
  const researchPerformed = didOrDidNot(findLine(lines, /research the sale or transfer history/i), checked, 98, 122);
  const subjectPriorSaleRevealed = didOrDidNot(subjRevealLine, checked, 129, 152);
  const comparablePriorSaleRevealed = didOrDidNot(compRevealLine, checked, 129, 152);

  // Data-source lines that belong to the prior-sale block (after each reveal line).
  const dsAfter = (line: TextLine | undefined): string => {
    if (!line) return "";
    const idx = lines.indexOf(line);
    for (let i = idx + 1; i < lines.length; i++) {
      if (/^Data Source\(s\)/i.test(lines[i].fullText)) {
        return lines[i].fullText.replace(/^Data Source\(s\)\s*/i, "").trim();
      }
      if (/reveal any prior sales|Report the results/i.test(lines[i].fullText)) break;
    }
    return "";
  };
  const subjectDataSources = dsAfter(subjRevealLine);
  const comparableDataSources = dsAfter(compRevealLine);

  // Prior-sale table rows are relative to the ITEM/SUBJECT/COMPARABLE header.
  const headerLine = findLine(lines, /^ITEM\s+SUBJECT\s+COMPARABLE SALE|ITEM.*COMPARABLE SALE #/i);
  const hIdx = headerLine ? lines.indexOf(headerLine) : -1;
  const dateLine = hIdx >= 0 ? lines[hIdx + 1] : findLine(lines, /Date of Prior Sale\/Transfer/i);
  const priceLine = hIdx >= 0 ? lines[hIdx + 2] : findLine(lines, /Price of Prior Sale\/Transfer/i);
  const psDsLine = hIdx >= 0 ? lines[hIdx + 3] : undefined;
  const effLine = hIdx >= 0 ? lines[hIdx + 4] : findLine(lines, /Effective Date of Data Source/i);

  const parseEntry = (col: { min: number; max: number }): PriorSaleEntry => ({
    dateOfPriorSale: colText(dateLine, col.min, col.max),
    priceOfPriorSale: colNum(priceLine, col.min, col.max),
    dataSources: colText(psDsLine, col.min, col.max),
    effectiveDateOfDataSources: colText(effLine, col.min, col.max),
    boundingBoxes: {},
  });

  const subject = parseEntry(PS_COLS[0]);
  const comparables = [parseEntry(PS_COLS[1]), parseEntry(PS_COLS[2]), parseEntry(PS_COLS[3])];

  const analysisLine = findLine(lines, /^Analysis of prior sale or transfer/i);
  let analysis = "";
  if (analysisLine) {
    const idx = lines.indexOf(analysisLine);
    const valueSeg = analysisLine.segments.find((s) => s.x > 300);
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
