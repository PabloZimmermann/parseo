import { extractLines, extractFilledRects, UnrecognizedFormatError } from "@parseo/shared";
import type { TextLine, FilledRect } from "@parseo/shared";
import type { Form1073Report } from "./types.js";
import { parseSubjectSection, parseContractSection, parseNeighborhoodSection, parseProjectSiteSection, parseProjectInfoSection } from "./parse-page1.js";
import { parseProjectAnalysisSection, parseUnitDescriptionSection, parsePriorSaleHistorySection } from "./parse-page2.js";
import { parseSalesComparisonSection, parseReconciliationSection, parseAppraiserInfo, parseLenderClientInfo } from "./parse-sales.js";

export async function parseForm1073(buffer: Buffer): Promise<Form1073Report> {
  const lines = await extractLines(buffer);
  return parseForm1073FromLines(lines, buffer);
}

export async function parseForm1073FromLines(lines: TextLine[], buffer?: Buffer, pageOffset = 0): Promise<Form1073Report> {
  // Format fingerprint: must have "Individual Condominium Unit Appraisal Report"
  // or "Form 1073" in the first 30 lines
  const head = lines.slice(0, 30).map((l) => l.fullText).join("\n");
  if (!/Individual Condominium Unit Appraisal Report|Form 1073/i.test(head)) {
    throw new UnrecognizedFormatError(
      "Form1073",
      "first 30 lines do not contain a Form 1073 / Individual Condominium Unit Appraisal Report signature",
    );
  }

  // Find the page that starts the main form (has the title)
  let formStartPage = 1;
  for (const l of lines) {
    if (/Individual Condominium Unit Appraisal Report/i.test(l.fullText)) {
      formStartPage = l.page;
      break;
    }
  }

  // If the form doesn't start on page 1, remap page numbers
  let internalOffset = 0;
  let workLines = lines;
  if (formStartPage > 1) {
    internalOffset = formStartPage - 1;
    workLines = lines
      .filter((l) => l.page >= formStartPage)
      .map((l) => ({ ...l, page: l.page - internalOffset }));
  }

  // ── Extract checkbox rects from the PDF graphics layer ──
  let checkboxRects: FilledRect[] = [];
  if (buffer) {
    // The real PDF page accounts for both server-level skipped pages and internal form offset
    const pdfPage1 = pageOffset + internalOffset + 1;
    checkboxRects = await extractFilledRects(buffer, [pdfPage1], { minSize: 3, maxSize: 10 });
  }

  // ── Page 1: Subject, Contract, Neighborhood, Project Site, Project Info ──
  const page1 = workLines.filter((l) => l.page === 1);
  const subject = parseSubjectSection(page1);
  const contract = parseContractSection(page1);
  const neighborhood = parseNeighborhoodSection(page1, checkboxRects);
  const projectSite = parseProjectSiteSection(page1);
  const projectInfo = parseProjectInfoSection(page1);

  // ── Page 2: Project Analysis, Unit Description, Prior Sale History ──
  const page2 = workLines.filter((l) => l.page === 2);
  const projectAnalysis = parseProjectAnalysisSection(page2);
  const unitDescription = parseUnitDescriptionSection(page2);
  const priorSaleHistory = parsePriorSaleHistorySection(page2);

  // ── Page 3: Sales Comparison (comps 1-3), Reconciliation ──
  const page3 = workLines.filter((l) => l.page === 3);
  const salesComparison = parseSalesComparisonSection(page3);
  const reconciliation = parseReconciliationSection(page3);

  // ── Pages 4-5: Definitions/Certifications (boilerplate, skip) ──

  // ── Page 6: Appraiser info ──
  const page6 = workLines.filter((l) => l.page === 6);
  const appraiser = parseAppraiserInfo(page6, false) ?? {
    name: "", companyName: "", companyAddress: "", telephoneNumber: "",
    emailAddress: "", dateOfSignature: "", effectiveDateOfAppraisal: "",
    stateCertification: "", stateOrLicense: "", state: "", expirationDate: "",
    boundingBoxes: {},
  };
  const supervisoryAppraiser = parseAppraiserInfo(page6, true);
  const lenderClient = parseLenderClientInfo(page6);

  // ── Additional comparables pages (7, 8, ...) ──
  for (let pageNum = 7; pageNum <= Math.max(...workLines.map((l) => l.page)); pageNum++) {
    const pageLines = workLines.filter((l) => l.page === pageNum);
    if (pageLines.length === 0) continue;
    // Check if this page has a comparable sales grid
    const hasCompGrid = pageLines.some((l) => /^FEATURE\s+SUBJECT\s+COMPARABLE SALE/i.test(l.fullText));
    if (!hasCompGrid) continue;

    // Determine the comp start number from the header
    const headerLine = pageLines.find((l) => /COMPARABLE SALE #\s*(\d+)/i.test(l.fullText));
    let compStart = salesComparison.comparables.length + 1;
    if (headerLine) {
      const m = headerLine.fullText.match(/COMPARABLE SALE #\s*(\d+)/i);
      if (m) compStart = parseInt(m[1], 10);
    }

    const additionalComps = parseSalesComparisonSection(pageLines, compStart);
    salesComparison.comparables.push(...additionalComps.comparables);
  }

  return {
    subject,
    contract,
    neighborhood,
    projectSite,
    projectInfo,
    projectAnalysis,
    unitDescription,
    priorSaleHistory,
    salesComparison,
    reconciliation,
    appraiser,
    supervisoryAppraiser,
    lenderClient,
  };
}
