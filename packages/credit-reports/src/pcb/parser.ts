import { extractLines, toBBox } from "@parseo/shared";
import { UnrecognizedFormatError, MissingSectionError } from "@parseo/shared";
import type { TextLine, BoundingBox } from "@parseo/shared";
import type {
  PCBCreditReport,
  ReportHeader,
  ApplicantInfo,
  ScoreModel,
  ScoreFactor,
  PublicRecord,
  Account,
  TrendedData,
  Inquiry,
  CreditBureauError,
} from "./types.js";
import { parseCurrency } from "@parseo/shared";
import { parseIntOrNull, normalizeDate } from "./utils.js";

// ── Section markers ──

const SECTION_MARKERS = [
  "CREDIT BUREAU ERRORS",
  "SCORE MODELS",
  "PUBLIC RECORDS",
  "DEROGATORY ACCOUNTS",
  "ACCOUNTS WITH BALANCE",
  "ACCOUNTS WITH NO BALANCE",
  "NON-DEROGATORY ACCOUNTS",
  "REAL ESTATE ACCOUNTS",
  "OTHER CREDIT HISTORY",
  "INQUIRIES (LAST",
  "TRADE SUMMARY",
  "SOURCE OF INFORMATION",
  "CREDITORS",
  "MISCELLANEOUS INFORMATION",
  "DISCLAIMER",
  "EQUIFAX FRAUDIQ",
  "ADDITIONAL REMARK",
] as const;

function isSectionHeader(text: string): boolean {
  const t = text.trim();
  return SECTION_MARKERS.some((m) => t.startsWith(m));
}

/** Lines we skip: page footers, column headers, ECOA KEY, page numbers */
function isBoilerplate(line: TextLine): boolean {
  const t = line.fullText.trim();
  if (t.startsWith("ECOA KEY:")) return true;
  if (t.startsWith("B=BORROWER;")) return true;
  if (t.startsWith("M=MAKER;")) return true;
  if (t.startsWith("PREMIUM CREDIT BUREAU:")) return true;
  if (t.startsWith("The information is furnished")) return true;
  if (t.startsWith("inquirer has agreed")) return true;
  if (t.startsWith("complies with the provisions")) return true;
  if (t.startsWith("and the Farmers Home")) return true;
  if (/^Page \d+\/\d+$/.test(t)) return true;
  return false;
}

/** Is this a per-page repeated header block? (FILE #, SEND TO, CUST. #, etc.) */
function isPageHeader(line: TextLine): boolean {
  const t = line.fullText.trim();
  if (t.startsWith("FILE #")) return true;
  if (t.startsWith("SEND TO")) return true;
  if (t.startsWith("CUST. #")) return true;
  if (t.includes("PRICE") && t.includes("LOAN TYPE")) return true;
  if (t.includes("PRICE") && /\$\d/.test(t) && line.segments[0]?.x > 100) return true;
  if (t.includes("REF. #") && !t.includes("CREDITOR") && line.segments[0]?.x > 100) return true;
  if (t === "PROPERTY ADDRESS") return true;
  if (t.startsWith("APPLICANT") && t.includes("CO-APPLICANT")) return true;
  if (t.startsWith("SOC SEC #") && line.page > 1) return true;
  if (t.startsWith("MARITAL STATUS") && line.page > 1) return true;
  // "SOFT" continuation of SEND TO line on some reports
  if (t === "SOFT" && line.segments[0]?.x > 100) return true;
  return false;
}

/** Is this a tradeline table column header? */
function isColumnHeader(line: TextLine): boolean {
  const t = line.fullText.trim();
  // multi-line column headers
  if (/^[WHECOSA]\s/.test(t) && t.length < 80) return true;
  if (t === "E" || t === "S") return true;
  return false;
}

function isUIArtifact(line: TextLine): boolean {
  const t = line.fullText.trim();
  if (t === "Add Product") return true;
  if (t.startsWith("Request New Tradeline")) return true;
  if (t.startsWith("Hide Trended Data")) return true;
  if (t === "Request New Tradeline  Hide Trended Data") return true;
  if (/^Phone:/.test(t)) return true;
  if (/^Fax:/.test(t)) return true;
  if (/^2701 E ATLANTIC BLVD/.test(t) && line.y < 135) return true;
  return false;
}

// ── Extract content lines (remove boilerplate, page headers, column headers) ──

interface SectionBlock {
  name: string;
  lines: TextLine[];
}

function getSections(allLines: TextLine[]): {
  headerLines: TextLine[];
  sections: SectionBlock[];
} {
  // Filter out boilerplate and UI artifacts
  const lines = allLines.filter(
    (l) => !isBoilerplate(l) && !isUIArtifact(l)
  );

  // First page before first section marker contains the report header + applicant info
  // Find the first section marker
  const firstSectionIdx = lines.findIndex((l) => isSectionHeader(l.fullText.trim()));
  const headerLines = firstSectionIdx > 0 ? lines.slice(0, firstSectionIdx) : [];

  // Split into sections
  const sections: SectionBlock[] = [];
  let currentSection: SectionBlock | null = null;

  for (let i = firstSectionIdx >= 0 ? firstSectionIdx : 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.fullText.trim();

    if (isSectionHeader(t)) {
      if (currentSection) sections.push(currentSection);
      currentSection = { name: t, lines: [] };
      continue;
    }

    // Skip page headers on subsequent pages and column headers
    if (isPageHeader(line)) continue;
    if (isColumnHeader(line)) continue;

    if (currentSection) {
      currentSection.lines.push(line);
    }
  }
  if (currentSection) sections.push(currentSection);

  return { headerLines, sections };
}

// ── Header parsing ──

function findSegmentAfter(line: TextLine, label: string): string {
  const segs = line.segments;
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].text.includes(label)) {
      // Value might be in the same segment after the label, or the next segment
      const afterLabel = segs[i].text.substring(
        segs[i].text.indexOf(label) + label.length
      ).trim();
      if (afterLabel) return afterLabel;
      if (i + 1 < segs.length) return segs[i + 1].text.trim();
      return "";
    }
  }
  return "";
}

/** Like findSegmentAfter but also returns the segment that holds the value. */
function findSegmentAfterWithSeg(line: TextLine, label: string): { value: string; seg: typeof line.segments[0] | null } {
  const segs = line.segments;
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].text.includes(label)) {
      const afterLabel = segs[i].text.substring(
        segs[i].text.indexOf(label) + label.length
      ).trim();
      if (afterLabel) return { value: afterLabel, seg: segs[i] };
      if (i + 1 < segs.length) return { value: segs[i + 1].text.trim(), seg: segs[i + 1] };
      return { value: "", seg: null };
    }
  }
  return { value: "", seg: null };
}

function parseHeader(lines: TextLine[]): ReportHeader {
  const bb: Record<string, BoundingBox> = {};
  const header: ReportHeader = {
    fileNumber: "",
    fnmaNumber: "",
    dateCompleted: "",
    dateOrdered: "",
    sendTo: "",
    customerNumber: "",
    repositories: "",
    preparedBy: "",
    requestedBy: "",
    price: null,
    loanType: "",
    refNumber: "",
    propertyAddress: "",
    boundingBoxes: bb,
  };

  for (const line of lines) {
    const t = line.fullText;
    if (t.includes("FILE #")) {
      const fileSeg = findSegmentAfterWithSeg(line, "FILE #");
      header.fileNumber = fileSeg.value.replace(/\s*FNMA #.*/, "");
      if (fileSeg.seg) bb.fileNumber = toBBox(fileSeg.seg, line);

      const fnmaSeg = findSegmentAfterWithSeg(line, "FNMA #");
      header.fnmaNumber = fnmaSeg.value.replace(/\s*DATE COMPLETED.*/, "").trim();
      if (fnmaSeg.seg) bb.fnmaNumber = toBBox(fnmaSeg.seg, line);

      // DATE COMPLETED might be in this line
      const dcMatch = t.match(/DATE COMPLETED\s+(\S+)/);
      if (dcMatch) {
        header.dateCompleted = normalizeDate(dcMatch[1]);
        const dcSeg = line.segments.find(s => s.text.includes("DATE COMPLETED"));
        if (dcSeg) bb.dateCompleted = toBBox(dcSeg, line);
      }
      const rqdMatch = t.match(/RQD['']?\s*BY\s+(.*?)$/);
      if (rqdMatch) {
        header.requestedBy = rqdMatch[1].trim();
        const rqdSeg = line.segments.find(s => s.text.includes("RQD"));
        if (rqdSeg) bb.requestedBy = toBBox(rqdSeg, line);
      }
    }
    if (t.includes("SEND TO")) {
      const sendSeg = findSegmentAfterWithSeg(line, "SEND TO");
      header.sendTo = sendSeg.value;
      if (sendSeg.seg) bb.sendTo = toBBox(sendSeg.seg, line);

      const doMatch = t.match(/DATE ORDERED\s+(\S+)/);
      if (doMatch) {
        header.dateOrdered = normalizeDate(doMatch[1]);
        const doSeg = line.segments.find(s => s.text.includes("DATE ORDERED"));
        if (doSeg) bb.dateOrdered = toBBox(doSeg, line);
      }
    }
    if (t.includes("CUST. #")) {
      const custSeg = findSegmentAfterWithSeg(line, "CUST. #");
      header.customerNumber = custSeg.value.replace(/\s*REPOSITORIES.*/, "");
      if (custSeg.seg) bb.customerNumber = toBBox(custSeg.seg, line);

      const repoSeg = findSegmentAfterWithSeg(line, "REPOSITORIES");
      header.repositories = repoSeg.value.replace(/\s*PRPD.*/, "");
      if (repoSeg.seg) bb.repositories = toBBox(repoSeg.seg, line);

      const prpdSeg = findSegmentAfterWithSeg(line, "PRPD' BY");
      if (prpdSeg.value) {
        header.preparedBy = prpdSeg.value;
        if (prpdSeg.seg) bb.preparedBy = toBBox(prpdSeg.seg, line);
      }
    }
    if (t.includes("PRICE")) {
      const pm = t.match(/PRICE\s+\$?([\d,.]+)/);
      if (pm) {
        header.price = parseCurrency("$" + pm[1]);
        const priceSeg = line.segments.find(s => s.text.includes("PRICE"));
        if (priceSeg) bb.price = toBBox(priceSeg, line);
      }
      const ltm = t.match(/LOAN TYPE\s+(.*?)$/);
      if (ltm) {
        header.loanType = ltm[1].trim();
        const ltSeg = line.segments.find(s => s.text.includes("LOAN TYPE"));
        if (ltSeg) bb.loanType = toBBox(ltSeg, line);
      }
    }
    if (t.includes("REF. #")) {
      const refSeg = findSegmentAfterWithSeg(line, "REF. #");
      header.refNumber = refSeg.value;
      if (refSeg.seg) bb.refNumber = toBBox(refSeg.seg, line);
    }
    if (t.startsWith("PROPERTY ADDRESS")) {
      const addrSeg = findSegmentAfterWithSeg(line, "PROPERTY ADDRESS");
      header.propertyAddress = addrSeg.value;
      if (addrSeg.seg) bb.propertyAddress = toBBox(addrSeg.seg, line);
    }
  }

  return header;
}

// ── Applicant parsing ──

function parseApplicantInfo(lines: TextLine[]): {
  applicant: ApplicantInfo;
  coApplicant: ApplicantInfo | null;
} {
  const bb: Record<string, BoundingBox> = {};
  const coBb: Record<string, BoundingBox> = {};
  const applicant: ApplicantInfo = {
    name: "",
    ssn: "",
    dob: "",
    currentAddress: "",
    currentAddressLength: "",
    previousAddress: "",
    previousAddressLength: "",
    maritalStatus: "",
    dependents: "",
    boundingBoxes: bb,
  };
  let coApplicant: ApplicantInfo | null = null;

  for (const line of lines) {
    const t = line.fullText;
    const segs = line.segments;

    // APPLICANT  MAYOR, JESS  CO-APPLICANT  SMITH, JANE
    if (t.startsWith("APPLICANT") && !t.startsWith("APPLICANT ") && t.includes("CO-APPLICANT") && !segs.some(s => s.text.includes("MAYOR") || s.text.includes("ABRAMS"))) {
      // This is the label row, skip
      continue;
    }

    if (t.startsWith("APPLICANT") && t.includes("CO-APPLICANT")) {
      // Parse applicant name - it's between APPLICANT and CO-APPLICANT
      const appIdx = segs.findIndex(s => s.text.trim() === "APPLICANT");
      const coIdx = segs.findIndex(s => s.text.trim().startsWith("CO-APPLICANT"));
      if (appIdx >= 0 && appIdx + 1 < segs.length && coIdx > appIdx + 1) {
        applicant.name = segs[appIdx + 1].text.trim();
        bb.name = toBBox(segs[appIdx + 1], line);
      } else if (appIdx >= 0) {
        // Name might be merged with APPLICANT segment
        const nameMatch = segs[appIdx]?.text.match(/APPLICANT\s+(.+?)(?:\s+CO-APPLICANT)?$/);
        if (nameMatch) {
          applicant.name = nameMatch[1].trim();
          bb.name = toBBox(segs[appIdx], line);
        }
        // Or in segments between APPLICANT and CO-APPLICANT
        for (let i = appIdx + 1; i < segs.length; i++) {
          if (segs[i].text.includes("CO-APPLICANT")) {
            // check if co-applicant name follows
            const coMatch = segs[i].text.match(/CO-APPLICANT\s+(.+)/);
            if (coMatch && coMatch[1].trim()) {
              if (!coApplicant) {
                coApplicant = {
                  name: "", ssn: "", dob: "",
                  currentAddress: "", currentAddressLength: "",
                  previousAddress: "", previousAddressLength: "",
                  maritalStatus: "", dependents: "",
                  boundingBoxes: coBb,
                };
              }
              coApplicant.name = coMatch[1].trim();
              coBb.name = toBBox(segs[i], line);
            }
            if (i + 1 < segs.length && !applicant.name) {
              // unlikely but handle
            }
            break;
          }
          if (!applicant.name) {
            applicant.name = segs[i].text.trim();
            bb.name = toBBox(segs[i], line);
          }
        }
      }
      // Co-applicant name after CO-APPLICANT
      if (coIdx >= 0 && coIdx + 1 < segs.length) {
        if (!coApplicant) {
          coApplicant = {
            name: "", ssn: "", dob: "",
            currentAddress: "", currentAddressLength: "",
            previousAddress: "", previousAddressLength: "",
            maritalStatus: "", dependents: "",
            boundingBoxes: coBb,
          };
        }
        coApplicant.name = segs[coIdx + 1].text.trim();
        coBb.name = toBBox(segs[coIdx + 1], line);
      } else if (coIdx >= 0) {
        const coMatch = segs[coIdx].text.match(/CO-APPLICANT\s+(.+)/);
        if (coMatch && coMatch[1].trim()) {
          if (!coApplicant) {
            coApplicant = {
              name: "", ssn: "", dob: "",
              currentAddress: "", currentAddressLength: "",
              previousAddress: "", previousAddressLength: "",
              maritalStatus: "", dependents: "",
              boundingBoxes: coBb,
            };
          }
          coApplicant.name = coMatch[1].trim();
          coBb.name = toBBox(segs[coIdx], line);
        }
      }
    }

    if (t.startsWith("SOC SEC #")) {
      // SOC SEC #  082-62-3448  DOB  SOC SEC #  DOB
      // Could have: SOC SEC #  xxx  DOB mm/dd/yyyy  SOC SEC #  yyy  DOB mm/dd/yyyy
      const ssnMatch = t.match(/SOC SEC #\s+([\d-]+)/);
      if (ssnMatch) {
        applicant.ssn = ssnMatch[1];
        const ssnSeg = segs.find(s => s.text.includes(ssnMatch[1]));
        if (ssnSeg) bb.ssn = toBBox(ssnSeg, line);
      }
      const dobMatch = t.match(/SOC SEC #\s+[\d-]+\s+DOB\s+(\S+)/);
      if (dobMatch && dobMatch[1] !== "SOC") {
        applicant.dob = normalizeDate(dobMatch[1]);
        const dobSeg = segs.find(s => s.text.includes(dobMatch[1]));
        if (dobSeg) bb.dob = toBBox(dobSeg, line);
      }

      // Co-applicant SSN (second SOC SEC #)
      const rest = t.replace(/^SOC SEC #\s+[\d-]+\s+DOB\s*\S*/, "");
      const coSsnMatch = rest.match(/SOC SEC #\s+([\d-]+)/);
      if (coSsnMatch && coSsnMatch[1]) {
        if (!coApplicant) {
          coApplicant = {
            name: "", ssn: "", dob: "",
            currentAddress: "", currentAddressLength: "",
            previousAddress: "", previousAddressLength: "",
            maritalStatus: "", dependents: "",
            boundingBoxes: coBb,
          };
        }
        coApplicant.ssn = coSsnMatch[1];
        const coSsnSeg = segs.find(s => s.text.includes(coSsnMatch[1]));
        if (coSsnSeg) coBb.ssn = toBBox(coSsnSeg, line);
        const coDobMatch = rest.match(/SOC SEC #\s+[\d-]+\s+DOB\s+(\S+)/);
        if (coDobMatch && coDobMatch[1] !== "SOC") {
          coApplicant.dob = normalizeDate(coDobMatch[1]);
          const coDobSeg = segs.find(s => s.text.includes(coDobMatch[1]));
          if (coDobSeg) coBb.dob = toBBox(coDobSeg, line);
        }
      }
    }

    if (t.startsWith("MARITAL STATUS")) {
      const msSeg = findSegmentAfterWithSeg(line, "MARITAL STATUS");
      applicant.maritalStatus = msSeg.value.replace(/\s*DEPENDENTS.*/, "").trim();
      if (msSeg.seg) bb.maritalStatus = toBBox(msSeg.seg, line);

      const depSeg = findSegmentAfterWithSeg(line, "DEPENDENTS");
      applicant.dependents = depSeg.value;
      if (depSeg.seg) bb.dependents = toBBox(depSeg.seg, line);
    }

    if (t.startsWith("CURRENT ADDRESS")) {
      const addrText = t.replace(/^CURRENT ADDRESS\s*/, "");
      const parts = addrText.split(/\s+LENGTH\s*/);
      applicant.currentAddress = (parts[0] || "").trim();
      applicant.currentAddressLength = (parts[1] || "").trim();
      const addrSeg = segs.find(s => !s.text.includes("CURRENT ADDRESS") && s.text.trim().length > 0) ?? segs[0];
      if (addrSeg) bb.currentAddress = toBBox(addrSeg, line);
    }

    if (t.startsWith("PREVIOUS ADDRESS")) {
      const addrText = t.replace(/^PREVIOUS ADDRESS\s*/, "");
      const parts = addrText.split(/\s+LENGTH\s*/);
      const addr = (parts[0] || "").trim();
      applicant.previousAddress = addr === "LENGTH" ? "" : addr;
      applicant.previousAddressLength = addr === "LENGTH" ? "" : (parts[1] || "").trim();
      if (applicant.previousAddress) {
        const prevSeg = segs.find(s => !s.text.includes("PREVIOUS ADDRESS") && s.text.trim().length > 0) ?? segs[0];
        if (prevSeg) bb.previousAddress = toBBox(prevSeg, line);
      }
    }
  }

  // If co-applicant was partially created but has no meaningful data, null it out
  if (coApplicant && !coApplicant.name && !coApplicant.ssn) {
    coApplicant = null;
  }

  return { applicant, coApplicant };
}

// ── Score Models parsing ──

function parseScoreModels(lines: TextLine[]): ScoreModel[] {
  const models: ScoreModel[] = [];
  let current: ScoreModel | null = null;
  let currentBb: Record<string, BoundingBox> = {};

  for (const line of lines) {
    const t = line.fullText.trim();
    if (!t || t === "*** NONE ***") continue;

    // Bureau/model header: "EQUIFAX/FICO CLASSIC V5 - JESS ERIC MAYOR - 082623448"
    const headerMatch = t.match(/^(.+?\/[^-]+?)\s+-\s+(.+?)(?:\s+-\s+(\d+))?\s*$/);
    if (headerMatch) {
      if (current) models.push(current);
      const [, bureauModel, name, ssn] = headerMatch;
      const slashIdx = bureauModel.indexOf("/");
      currentBb = {};
      if (line.segments[0]) currentBb.bureau = toBBox(line.segments[0], line);
      current = {
        bureau: bureauModel.substring(0, slashIdx).trim(),
        modelName: bureauModel.substring(slashIdx + 1).trim(),
        applicantName: name.trim(),
        ssn: ssn || "",
        score: null,
        factors: [],
        boundingBoxes: currentBb,
      };
      continue;
    }

    // Score line: "SCORE: 780"
    const scoreMatch = t.match(/^SCORE:\s+(\d+)/);
    if (scoreMatch && current) {
      current.score = parseInt(scoreMatch[1], 10);
      if (line.segments[0]) currentBb.score = toBBox(line.segments[0], line);
      continue;
    }

    // Factor line: "00030 - TIME SINCE MOST RECENT ACCOUNT OPENING IS TOO SHORT"
    // or "FA - INQUIRIES IMPACTED THE CREDIT SCORE"
    const factorMatch = t.match(/^(\S+)\s+-\s+(.+)$/);
    if (factorMatch && current) {
      current.factors.push({
        code: factorMatch[1],
        description: factorMatch[2].trim(),
      });
      continue;
    }
  }
  if (current) models.push(current);

  return models;
}

// ── Public Records parsing ──

function parsePublicRecords(lines: TextLine[]): PublicRecord[] {
  const records: PublicRecord[] = [];
  for (const line of lines) {
    const t = line.fullText.trim();
    if (!t || t === "*** NONE ***") continue;
    const bb: Record<string, BoundingBox> = {};
    if (line.segments[0]) bb.rawText = toBBox(line.segments[0], line);
    records.push({ rawText: t, boundingBoxes: bb });
  }
  return records;
}

// ── Credit Bureau Errors ──

function parseCreditBureauErrors(lines: TextLine[]): CreditBureauError[] {
  const errors: CreditBureauError[] = [];
  for (const line of lines) {
    const t = line.fullText.trim();
    if (!t || t.startsWith("***")) continue;
    const bb: Record<string, BoundingBox> = {};
    if (line.segments[0]) bb.rawText = toBBox(line.segments[0], line);
    errors.push({ rawText: t, boundingBoxes: bb });
  }
  return errors;
}

// ── Account parsing ──

/**
 * Parse a tradeline account from the first line (main data) and subsequent
 * detail lines (account number, history, description, trended data).
 */
function parseAccountBlock(blockLines: TextLine[]): Account {
  const bb: Record<string, BoundingBox> = {};
  const acct: Account = {
    ecoa: "",
    whose: "",
    creditor: "",
    dateReported: "",
    dateOpened: "",
    highCreditOrLimit: null,
    balance: null,
    pastDue: null,
    monthsReviewed: null,
    late30: null,
    late60: null,
    late90Plus: null,
    status: "",
    accountNumber: "",
    dla: "",
    accountType: "",
    terms: "",
    source: "",
    history: "",
    description: "",
    trended: null,
    boundingBoxes: bb,
  };

  if (blockLines.length === 0) return acct;

  // First line: main account data
  // E.g. "B B NATIONSTAR/MR COOPER  06/24  12/23  $390000  $388497  $0 6  0 0 0 AS AGREED"
  const mainLine = blockLines[0];
  parseMainAccountLine(mainLine, acct, bb);

  // Second line (if exists): account number, DLA, acct type, terms, source
  // E.g. "717619365  06/24  MTG 360 $3633  XP/TU/EF"
  // or   "717619365  06/24  MTG  360 $3633  XP/TU/EF"
  if (blockLines.length > 1) {
    parseDetailLine(blockLines[1], acct, bb);
  }

  // Remaining lines: history, description, trended data, payment amounts
  const descParts: string[] = [];
  let trendedMonths: string[] | null = null;
  let trendedScheduled: (number | null)[] = [];
  let trendedActual: (number | null)[] = [];
  let trendedBalance: (number | null)[] = [];
  let hasTrended = false;

  for (let i = 2; i < blockLines.length; i++) {
    const t = blockLines[i].fullText.trim();

    // History line
    const histMatch = t.match(/^History:\s+(.+)$/);
    if (histMatch) {
      acct.history = histMatch[1].trim();
      if (blockLines[i].segments[0]) bb.history = toBBox(blockLines[i].segments[0], blockLines[i]);
      continue;
    }

    // Trended header: "Trended  05/24  04/24  ..."
    if (t.startsWith("Trended")) {
      const parts = t.split(/\s{2,}/).slice(1);
      trendedMonths = parts.map((p) => p.trim());
      hasTrended = true;
      continue;
    }

    // Trended row: "Scheduled ($)  3633  3633  ..."
    const scheduledMatch = t.match(/^Scheduled\s*\(\$\)\s+(.+)$/);
    if (scheduledMatch) {
      trendedScheduled = parseTrendedRow(scheduledMatch[1]);
      continue;
    }

    const actualMatch = t.match(/^Actual\s*\(\$\)\s+(.+)$/);
    if (actualMatch) {
      trendedActual = parseTrendedRow(actualMatch[1]);
      continue;
    }

    const balanceMatch = t.match(/^Balance\s*\(\$\)\s+(.+)$/);
    if (balanceMatch) {
      trendedBalance = parseTrendedRow(balanceMatch[1]);
      continue;
    }

    // Payment amount line (e.g. "$11531*") - sometimes appears alone after detail line
    if (/^\$[\d,]+\*?$/.test(t)) {
      continue;
    }

    // Skip empty/junk
    if (!t || t === "-") continue;

    // Everything else is description
    descParts.push(t);
  }

  acct.description = descParts.join("; ");

  if (hasTrended && trendedMonths) {
    acct.trended = {
      months: trendedMonths,
      scheduled: trendedScheduled,
      actual: trendedActual,
      balance: trendedBalance,
    };
  }

  return acct;
}

function parseTrendedRow(raw: string): (number | null)[] {
  // Trended data values may be separated by double spaces (across segments)
  // or single spaces (within a merged segment like "311734 312229 312720").
  // Split on double-space first to get segment groups, then split each group on single spaces.
  const segmentGroups = raw.split(/\s{2,}/);
  const values: (number | null)[] = [];
  for (const group of segmentGroups) {
    const trimmed = group.trim();
    if (!trimmed) continue;
    // If this group contains spaces, it's multiple values merged
    const parts = trimmed.split(/\s+/);
    for (const part of parts) {
      const p = part.trim();
      if (p === "-" || p === "") {
        values.push(null);
      } else {
        const n = Number(p.replace(/,/g, ""));
        values.push(isNaN(n) ? null : n);
      }
    }
  }
  return values;
}

function parseMainAccountLine(line: TextLine, acct: Account, bb: Record<string, BoundingBox>): void {
  const segs = line.segments;
  if (segs.length === 0) return;

  // First segment: "B B NATIONSTAR/MR COOPER" or "J B CITIBANK NA"
  const firstSeg = segs[0].text.trim();
  const ecoaMatch = firstSeg.match(/^([A-Z])\s+([A-Z])\s+(.+)$/);
  if (ecoaMatch) {
    acct.ecoa = ecoaMatch[1];
    acct.whose = ecoaMatch[2];
    acct.creditor = ecoaMatch[3].trim();
    bb.creditor = toBBox(segs[0], line);
  } else {
    // Fallback: whole segment is creditor
    acct.creditor = firstSeg;
    bb.creditor = toBBox(segs[0], line);
  }

  // Rest of segments contain dates, amounts, and status
  // Typical: ["06/24", "12/23", "$390000", "$388497", "$0 6", "0 0 0 AS AGREED"]
  // Derog:   ["11/24", "03/21", "$130", "$130", "$130", "-", "-", "- COLLECTION"]
  const rest = segs.slice(1).map((s) => s.text.trim());

  if (rest.length >= 1) { acct.dateReported = normalizeDate(rest[0]); bb.dateReported = toBBox(segs[1], line); }
  if (rest.length >= 2) { acct.dateOpened = normalizeDate(rest[1]); bb.dateOpened = toBBox(segs[2], line); }
  if (rest.length >= 3) { acct.highCreditOrLimit = parseCurrency(rest[2]); bb.highCreditOrLimit = toBBox(segs[3], line); }
  if (rest.length >= 4) { acct.balance = parseCurrency(rest[3]); bb.balance = toBBox(segs[4], line); }

  // Join remaining segments after balance into one string and parse
  // This handles variable segment splits for pastDue, months, late counts, status
  if (rest.length >= 5) {
    const tailStr = rest.slice(4).join(" ").trim();
    // Pattern: $pastDue monthsReviewed late30 late60 late90+ STATUS_TEXT
    // e.g.:    $0 6 0 0 0 AS AGREED
    const fullMatch = tailStr.match(
      /^(\$?[\d,]+|-)\s+(\d+|-)\s+(\d+|-)\s+(\d+|-)\s+(\d+|-)\s+(.+)$/
    );
    if (fullMatch) {
      acct.pastDue = parseCurrency(fullMatch[1]);
      acct.monthsReviewed = parseIntOrNull(fullMatch[2]);
      acct.late30 = parseIntOrNull(fullMatch[3]);
      acct.late60 = parseIntOrNull(fullMatch[4]);
      acct.late90Plus = parseIntOrNull(fullMatch[5]);
      acct.status = fullMatch[6].trim();
    } else {
      // Derogatory/collection pattern: $pastDue - - - STATUS (no months, no late counts)
      // or: $pastDue - - STATUS
      const derogMatch = tailStr.match(
        /^(\$?[\d,]+|-)\s+(-)\s+(-)\s+(-)\s+(.+)$/
      );
      if (derogMatch) {
        acct.pastDue = parseCurrency(derogMatch[1]);
        acct.status = derogMatch[5].trim();
      } else {
        // Fallback: first token is pastDue, try to extract the rest
        const tokens = tailStr.split(/\s+/);
        acct.pastDue = parseCurrency(tokens[0]);
        // Try to find status - it's the text after all numeric/dash tokens
        let statusStart = 1;
        for (let i = 1; i < tokens.length; i++) {
          if (/^\d+$/.test(tokens[i]) || tokens[i] === "-") {
            if (i === 1) acct.monthsReviewed = parseIntOrNull(tokens[i]);
            else if (i === 2) acct.late30 = parseIntOrNull(tokens[i]);
            else if (i === 3) acct.late60 = parseIntOrNull(tokens[i]);
            else if (i === 4) acct.late90Plus = parseIntOrNull(tokens[i]);
            statusStart = i + 1;
          } else {
            statusStart = i;
            break;
          }
        }
        if (statusStart < tokens.length) {
          acct.status = tokens.slice(statusStart).join(" ");
        }
      }
    }
  }
}

function parseDetailLine(line: TextLine, acct: Account, bb: Record<string, BoundingBox>): void {
  const segs = line.segments;
  if (segs.length === 0) return;

  // First segment: account number
  acct.accountNumber = segs[0].text.trim();
  bb.accountNumber = toBBox(segs[0], line);

  // Remaining segments: DLA, acct type/terms, source
  // They can vary in number. Find them by content/position.
  // DLA is typically at x~235, acct type at x~293-299, terms at x~330-370, source at x~513
  let acctTypeParsed = false;
  for (let i = 1; i < segs.length; i++) {
    const t = segs[i].text.trim();
    const x = segs[i].x;

    if (x > 200 && x < 260 && /^\d{2}\/\d{2}$|^--\/--$/.test(t)) {
      // DLA
      acct.dla = normalizeDate(t);
      bb.dla = toBBox(segs[i], line);
    } else if (x > 260 && x < 320 && !acctTypeParsed) {
      // Account type + possibly terms merged (e.g. "MTG 360 $3633", "REV", "COLL")
      parseAccountTypeTerms(t, acct);
      bb.accountType = toBBox(segs[i], line);
      acctTypeParsed = true;
    } else if (x >= 320 && x < 420 && acctTypeParsed) {
      // Terms (e.g. "360 $3633", "MIN $46", "001 -", "-")
      if (t !== "-") {
        acct.terms = acct.terms ? acct.terms + " " + t : t;
        if (!bb.terms) bb.terms = toBBox(segs[i], line);
      }
    } else if (x > 480) {
      // Source (XP/TU/EF)
      acct.source = t;
      bb.source = toBBox(segs[i], line);
    }
  }
}

function parseAccountTypeTerms(text: string, acct: Account): void {
  // Split on whitespace
  const parts = text.split(/\s+/);
  if (parts.length === 0) return;

  acct.accountType = parts[0];

  // Remaining parts form the terms string
  if (parts.length > 1) {
    acct.terms = parts.slice(1).join(" ");
  }
}

// ── Account section parsing (splits lines into individual account blocks) ──

function parseAccountSection(lines: TextLine[]): Account[] {
  const accounts: Account[] = [];
  if (lines.length === 0) return accounts;

  // Check for "*** NONE ***"
  if (lines.length === 1 && lines[0].fullText.trim() === "*** NONE ***") return accounts;
  if (lines.every((l) => l.fullText.trim() === "*** NONE ***" || !l.fullText.trim())) return accounts;

  // Split into account blocks. Each account starts with a line whose first segment
  // matches the pattern: "[A-Z] [A-Z] CREDITOR_NAME" at x < 40.
  // Orphan lines (continuations from page breaks) before any account start
  // get attached to the previous block.
  const blocks: TextLine[][] = [];
  let currentBlock: TextLine[] = [];
  let seenAccountStart = false;

  for (const line of lines) {
    const t = line.fullText.trim();
    if (!t || t === "*** NONE ***") continue;

    // Detect start of a new account: first segment starts with "X X CREDITOR"
    // AND starts at x ~25 (not x ~50 which is detail/description lines)
    const firstSeg = line.segments[0]?.text.trim() || "";
    const firstX = line.segments[0]?.x ?? 0;
    const isAccountStart = /^[A-Z]\s+[A-Z]\s+\S/.test(firstSeg) && firstX < 40;

    if (isAccountStart) {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock);
      }
      currentBlock = [];
      seenAccountStart = true;
    } else if (!seenAccountStart && blocks.length > 0) {
      // Orphan lines before first account start on this section page
      // Append to previous block
      blocks[blocks.length - 1].push(line);
      continue;
    }
    currentBlock.push(line);
  }
  if (currentBlock.length > 0) blocks.push(currentBlock);

  for (const block of blocks) {
    // Skip blocks that don't start with an account line (orphan at very beginning)
    const firstSeg = block[0]?.segments[0]?.text.trim() || "";
    const firstX = block[0]?.segments[0]?.x ?? 0;
    const isAccountStart = /^[A-Z]\s+[A-Z]\s+\S/.test(firstSeg) && firstX < 40;
    if (!isAccountStart) continue;
    accounts.push(parseAccountBlock(block));
  }

  return accounts;
}

// ── Inquiries parsing ──

function parseInquiries(lines: TextLine[]): Inquiry[] {
  const inquiries: Inquiry[] = [];

  for (const line of lines) {
    const t = line.fullText.trim();
    if (!t || t === "*** NONE ***") continue;

    // Format: "EF  B  08/26/23  THD/CBNA  FINANCE"
    // or "XP/EF  B  09/30/24  XACTUS-AVANTUS/SUPREME  FINANCE"
    const segs = line.segments;
    if (segs.length >= 3) {
      const bureau = segs[0].text.trim();
      // Sometimes whose is merged with bureau, sometimes separate
      let whose = "";
      let dateStr = "";
      let creditor = "";
      let type = "";

      if (segs.length >= 4) {
        whose = segs[1].text.trim();
        dateStr = segs[2].text.trim();
        creditor = segs[3].text.trim();
        type = segs.length >= 5 ? segs[4].text.trim() : "";
      } else {
        // 3 segments: bureau+whose, date+creditor, type
        const firstParts = bureau.split(/\s+/);
        if (firstParts.length >= 2) {
          // bureau might include whose
        }
        dateStr = segs[1].text.trim();
        creditor = segs[2].text.trim();
      }

      // Try to parse from full text as fallback
      const inqMatch = t.match(
        /^([\w/]+)\s+([A-Z])\s+(\d{2}\/\d{2}\/\d{2,4})\s+(.+?)\s{2,}(.+)$/
      );
      if (inqMatch) {
        const inqBb: Record<string, BoundingBox> = {};
        if (segs[0]) inqBb.bureau = toBBox(segs[0], line);
        if (segs.length >= 3) inqBb.date = toBBox(segs[2], line);
        if (segs.length >= 4) inqBb.creditor = toBBox(segs[3], line);
        if (segs.length >= 5) inqBb.type = toBBox(segs[4], line);
        inquiries.push({
          bureau: inqMatch[1],
          whose: inqMatch[2],
          date: normalizeDate(inqMatch[3]),
          creditor: inqMatch[4].trim(),
          type: inqMatch[5].trim(),
          boundingBoxes: inqBb,
        });
      } else {
        // Simpler pattern
        const simpleMatch = t.match(
          /^([\w/]+)\s+([A-Z])\s+(\d{2}\/\d{2}\/\d{2,4})\s+(.+)$/
        );
        if (simpleMatch) {
          const remaining = simpleMatch[4].trim();
          const lastSpace = remaining.lastIndexOf("  ");
          const inqBb: Record<string, BoundingBox> = {};
          if (segs[0]) inqBb.bureau = toBBox(segs[0], line);
          if (segs.length >= 3) inqBb.date = toBBox(segs[2], line);
          if (segs.length >= 4) inqBb.creditor = toBBox(segs[3], line);
          inquiries.push({
            bureau: simpleMatch[1],
            whose: simpleMatch[2],
            date: normalizeDate(simpleMatch[3]),
            creditor: lastSpace > 0 ? remaining.substring(0, lastSpace).trim() : remaining,
            type: lastSpace > 0 ? remaining.substring(lastSpace).trim() : "",
            boundingBoxes: inqBb,
          });
        }
      }
    }
  }

  return inquiries;
}

// ── Main parse function ──

export function parsePCBFromLines(allLines: TextLine[]): PCBCreditReport {
  // Format fingerprint check
  const head = allLines.slice(0, 30).map((l) => l.fullText).join("\n");
  if (!/Premium Credit Bureau|MERGED INFILE CREDIT REPORT/i.test(head)) {
    throw new UnrecognizedFormatError(
      "PCB",
      "first 30 lines do not contain a Premium Credit Bureau / MERGED INFILE CREDIT REPORT signature"
    );
  }

  const { headerLines, sections } = getSections(allLines);

  // Parse header and applicant from first-page header lines
  const header = parseHeader(headerLines);
  const { applicant, coApplicant } = parseApplicantInfo(headerLines);

  // Aggregate lines from same-named sections (section headers repeat per page)
  const sectionLineMap = new Map<string, TextLine[]>();
  for (const section of sections) {
    // Normalize section name to a category key
    let key = section.name;
    if (key.startsWith("ACCOUNTS WITH BALANCE")) key = "ACCOUNTS WITH BALANCE";
    else if (key.startsWith("ACCOUNTS WITH NO BALANCE")) key = "ACCOUNTS WITH NO BALANCE";
    else if (key.startsWith("NON-DEROGATORY ACCOUNTS")) key = "NON-DEROGATORY ACCOUNTS";
    else if (key.startsWith("DEROGATORY ACCOUNTS")) key = "DEROGATORY ACCOUNTS";
    else if (key.startsWith("REAL ESTATE ACCOUNTS")) key = "REAL ESTATE ACCOUNTS";
    else if (key.startsWith("INQUIRIES (LAST")) key = "INQUIRIES";
    else if (key.startsWith("SCORE MODELS")) key = "SCORE MODELS";
    else if (key.startsWith("PUBLIC RECORDS")) key = "PUBLIC RECORDS";
    else if (key.startsWith("CREDIT BUREAU ERRORS")) key = "CREDIT BUREAU ERRORS";

    const existing = sectionLineMap.get(key) ?? [];
    existing.push(...section.lines);
    sectionLineMap.set(key, existing);
  }

  const creditBureauErrors = parseCreditBureauErrors(sectionLineMap.get("CREDIT BUREAU ERRORS") ?? []);
  const scoreModels = parseScoreModels(sectionLineMap.get("SCORE MODELS") ?? []);
  const publicRecords = parsePublicRecords(sectionLineMap.get("PUBLIC RECORDS") ?? []);
  const derogatoryAccounts = parseAccountSection(sectionLineMap.get("DEROGATORY ACCOUNTS") ?? []);
  const accountsWithBalance = [
    ...parseAccountSection(sectionLineMap.get("ACCOUNTS WITH BALANCE") ?? []),
    ...parseAccountSection(sectionLineMap.get("NON-DEROGATORY ACCOUNTS") ?? []),
  ];
  const accountsWithNoBalance = parseAccountSection(sectionLineMap.get("ACCOUNTS WITH NO BALANCE") ?? []);
  const realEstateAccounts = parseAccountSection(sectionLineMap.get("REAL ESTATE ACCOUNTS") ?? []);
  const inquiries = parseInquiries(sectionLineMap.get("INQUIRIES") ?? []);

  // Required section validation
  if (!applicant.name) {
    throw new MissingSectionError("PCB", "applicant.name");
  }

  return {
    header,
    applicant,
    coApplicant,
    creditBureauErrors,
    scoreModels,
    publicRecords,
    derogatoryAccounts,
    accountsWithBalance,
    accountsWithNoBalance,
    realEstateAccounts,
    inquiries,
  };
}

export async function parsePCBReport(buffer: Buffer): Promise<PCBCreditReport> {
  const allLines = await extractLines(buffer);
  return parsePCBFromLines(allLines);
}
