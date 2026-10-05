import { extractLines, UnrecognizedFormatError } from "@parseo/shared";
import type { TextLine } from "@parseo/shared";
import { extractCheckedBoxes } from "../form-1004mc/extract-checkboxes.js";
import type { CheckedPosition } from "../form-1004mc/extract-checkboxes.js";
import type { Form1025Report } from "./types.js";
import {
  parseSubjectSection,
  parseContractSection,
  parseNeighborhoodSection,
  parseSiteSection,
  parseImprovementsSection,
} from "./parse-page1.js";
import {
  parseComparableRentalDataSection,
  parseSubjectRentScheduleSection,
  parsePriorSaleHistorySection,
} from "./parse-page2.js";
import {
  parseSalesComparisonSection,
  parseIncomeSection,
  parseReconciliationSection,
} from "./parse-sales.js";
import {
  parseAdditionalComments,
  parseCostApproachSection,
  parseAppraiserInfo,
  parseLenderClientInfo,
} from "./parse-page4.js";

export async function parseForm1025(buffer: Buffer): Promise<Form1025Report> {
  const lines = await extractLines(buffer);
  return parseForm1025FromLines(lines, buffer);
}

export async function parseForm1025FromLines(
  lines: TextLine[],
  buffer?: Buffer,
  pageOffset = 0,
): Promise<Form1025Report> {
  // Find the page that starts the main form (has the title). The form may be
  // embedded behind cover/invoice pages, so scan the whole document.
  let formStartPage = -1;
  for (const l of lines) {
    if (/Small Residential Income Property Appraisal Report/i.test(l.fullText)) {
      formStartPage = l.page;
      break;
    }
  }
  if (formStartPage < 0) {
    const sig = lines.some((l) => /Fannie Mae Form 1025\b|Freddie Mac Form 72\b/i.test(l.fullText));
    if (!sig) {
      throw new UnrecognizedFormatError(
        "Form1025",
        "no page contains a Form 1025 / Small Residential Income Property Appraisal Report signature",
      );
    }
    formStartPage = 1;
  }

  // Remap page numbers so section parsers can use page===1, 2, ... consistently.
  let internalOffset = 0;
  let workLines = lines;
  if (formStartPage > 1) {
    internalOffset = formStartPage - 1;
    workLines = lines
      .filter((l) => l.page >= formStartPage)
      .map((l) => ({ ...l, page: l.page - internalOffset }));
  }

  const page = (n: number) => workLines.filter((l) => l.page === n);
  const page1 = page(1), page2 = page(2), page3 = page(3), page4 = page(4);
  // Appraiser block is on form page 7
  const page7 = page(7);

  // Checkbox marks are rendered as vector paths; extract per physical page.
  const physical = (formPage: number) => pageOffset + internalOffset + formPage;
  const noChecks: CheckedPosition[] = [];
  const [checked1, checked2, checked3, checked4] = buffer
    ? await Promise.all([
        extractCheckedBoxes(buffer, physical(1)),
        extractCheckedBoxes(buffer, physical(2)),
        extractCheckedBoxes(buffer, physical(3)),
        extractCheckedBoxes(buffer, physical(4)),
      ])
    : [noChecks, noChecks, noChecks, noChecks];

  // ── Page 1: Subject, Contract, Neighborhood, Site, Improvements ──
  const subject = parseSubjectSection(page1, checked1);
  const contract = parseContractSection(page1, checked1);
  const neighborhood = parseNeighborhoodSection(page1, checked1);
  const site = parseSiteSection(page1, checked1);
  const improvements = parseImprovementsSection(page1, page2, checked1, checked2);

  // ── Page 2: Comparable Rentals, Rent Schedule, Prior Sale History ──
  const comparableRentalData = parseComparableRentalDataSection(page2, checked2);
  const subjectRentSchedule = parseSubjectRentScheduleSection(page2);
  const priorSaleHistory = parsePriorSaleHistorySection(page2, checked2);

  // ── Page 3: Sales Comparison, Income, Reconciliation ──
  const salesComparison = parseSalesComparisonSection(page3, checked3);
  const income = parseIncomeSection(page3);
  const reconciliation = parseReconciliationSection(page3, checked3);

  // ── Page 4: Additional Comments, Cost Approach ──
  const additionalComments = parseAdditionalComments(page4);
  const costApproach = parseCostApproachSection(page4, checked4);

  // ── Page 7: Appraiser, Supervisory Appraiser, Lender/Client ──
  const appraiser = parseAppraiserInfo(page7, false) ?? {
    name: "", companyName: "", companyAddress: "", telephoneNumber: "",
    emailAddress: "", dateOfSignature: "", effectiveDateOfAppraisal: "",
    stateCertification: "", stateOrLicense: "", state: "", expirationDate: "",
    boundingBoxes: {},
  };
  const supervisoryAppraiser = parseAppraiserInfo(page7, true);
  const lenderClient = parseLenderClientInfo(page7);

  return {
    appraisalType: "1025",
    subject,
    contract,
    neighborhood,
    site,
    improvements,
    comparableRentalData,
    subjectRentSchedule,
    priorSaleHistory,
    salesComparison,
    income,
    reconciliation,
    costApproach,
    additionalComments,
    appraiser,
    supervisoryAppraiser,
    lenderClient,
  };
}
