import { extractLines, toBBox } from "@parseo/shared";
import { UnrecognizedFormatError, MissingSectionError } from "@parseo/shared";
import { parseDate, parseCurrency, parseNum, getSection } from "@parseo/shared";
import {
  splitIntoSections,
  getSections,
  findLabelValue,
} from "./utils.js";
import type { TextLine, BoundingBox, TextSegment } from "@parseo/shared";
import type { Section } from "./utils.js";
import type {
  XactusCreditReport,
  ReportHeader,
  BorrowerInfo,
  CreditScoreEntry,
  FraudMessage,
  CreditSummaryRow,
  CreditSummaryStats,
  Tradeline,
  Inquiry,
  PublicRecord,
  RepositoryFile,
  Creditor,
} from "./types.js";

// ── Deduplication ────────────────────────────────────────────────────────────

/**
 * The PDF repeats the header block on every page. We deduplicate by removing
 * lines that match the header pattern on pages > 1 (repeated letterhead,
 * client info, borrower info block before Credit Score Information).
 */
export function deduplicateLines(lines: TextLine[]): TextLine[] {
  // Find the index of the first "Credit Score Information" or "Credit History" or first real section
  // Everything before that on page 1 is the header+borrower block.
  // On subsequent pages, we see the same header repeated — skip those.
  const result: TextLine[] = [];
  let inPageHeader = false;
  let lastPage = 0;

  for (const line of lines) {
    if (line.page !== lastPage) {
      // New page — start skipping the repeated header
      if (line.page > 1) {
        inPageHeader = true;
      }
      lastPage = line.page;
    }

    if (inPageHeader) {
      // Check if we've reached the end of repeated header block
      // The repeated block ends at "Borrower" / "Co-Borrower" line and the borrower info,
      // OR at a section header. We detect the end by checking for section headers or
      // content lines that aren't part of the header.
      const text = line.fullText.trim();

      // Skip known header lines
      if (
        text.match(/^\d+ Reed Rd/) ||
        text.match(/^\d+-\d+-\d+ Fax/) ||
        text.includes("Client Code:") ||
        text.includes("Requested By:") ||
        text.includes("Loan Number:") ||
        text === "Order Verifications" ||
        text.match(/^Borrower\s+Co-Borrower$/) ||
        (text.startsWith("Name") && line.segments.length >= 2 && line.segments.some(s => s.text.trim() === "Name")) ||
        (text.startsWith("SSN") && line.segments.length >= 2 && line.segments.some(s => s.text.trim() === "SSN")) ||
        text.match(/^Current Address\s+Current Address$/) ||
        (line.segments.length === 1 && line.segments[0].x < 300 && !isKnownSectionHeader(text) && isAddressLike(text)) ||
        text.match(/^Page \d+ of \d+$/)
      ) {
        continue;
      }

      inPageHeader = false;
      result.push(line);
    } else {
      // Skip "Page X of Y" lines
      if (line.fullText.trim().match(/^Page \d+ of \d+$/)) continue;
      result.push(line);
    }
  }

  return result;
}

function isKnownSectionHeader(text: string): boolean {
  const headers = [
    "Credit Score Information",
    "Fraud Messages",
    "Credit Summary",
    "Credit History",
    "Inquiries (Last 120 Days)",
    "Inquiries (continued)",
    "Public Records",
    "Repository Files Returned",
    "Repository/Fraud Messages",
    "Creditors",
    "Disclaimer",
    "Credit Repositories",
    "File Variation Warning",
  ];
  return headers.includes(text);
}

function isAddressLike(text: string): boolean {
  // Simple heuristic: contains comma and state abbreviation or zip
  return /,\s*[A-Z]{2}\s+\d{5}/.test(text) || /,\s*[A-Z][a-z]+,?\s*[A-Z]{2}/.test(text);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Find the segment that carries the *value* for a given label on a line. */
function findLabelValueSeg(line: TextLine, label: string): TextSegment | undefined {
  for (let i = 0; i < line.segments.length; i++) {
    const seg = line.segments[i];
    if (seg.text.trim().startsWith(label)) {
      const after = seg.text.trim().slice(label.length).trim();
      if (after) return seg;                       // value is in the same segment
      if (i + 1 < line.segments.length) return line.segments[i + 1]; // next segment
    }
  }
  return undefined;
}

// ── Header parsing ───────────────────────────────────────────────────────────

function parseHeader(lines: TextLine[]): ReportHeader {
  const bb: Record<string, BoundingBox> = {};
  const header: ReportHeader = {
    clientName: "",
    clientCode: "",
    ordered: null,
    released: null,
    reissued: null,
    reportId: "",
    repositories: [],
    price: null,
    loanNumber: "",
    requestedBy: "",
    boundingBoxes: bb,
  };

  for (const line of lines) {
    const text = line.fullText;

    if (text.includes("Client Code:")) {
      // First segment is client name
      header.clientName = line.segments[0]?.text.trim() ?? "";
      if (line.segments[0]) bb.clientName = toBBox(line.segments[0], line);
      header.clientCode = findLabelValue(line, "Client Code:");
      const ccSeg = findLabelValueSeg(line, "Client Code:");
      if (ccSeg) bb.clientCode = toBBox(ccSeg, line);
      header.ordered = parseDate(findLabelValue(line, "Ordered:"));
      const ordSeg = findLabelValueSeg(line, "Ordered:");
      if (ordSeg) bb.ordered = toBBox(ordSeg, line);
      header.reportId = findLabelValue(line, "Report ID:");
      const ridSeg = findLabelValueSeg(line, "Report ID:");
      if (ridSeg) bb.reportId = toBBox(ridSeg, line);
    }

    if (text.includes("Requested By:") || text.includes("Released:")) {
      // "Requested By:" may be concatenated with address or in its own segment
      const rbRaw = findLabelValue(line, "Requested By:");
      if (rbRaw) {
        header.requestedBy = rbRaw.replace(/Released:.*/, "").trim();
        const rbSeg = findLabelValueSeg(line, "Requested By:");
        if (rbSeg) bb.requestedBy = toBBox(rbSeg, line);
      }
      // Also try extracting from the full text
      if (!header.requestedBy) {
        const rbMatch = text.match(/Requested By:\s*(.+?)(?:\s{2,}|Released:)/);
        if (rbMatch) header.requestedBy = rbMatch[1].trim();
      }
      header.released = parseDate(findLabelValue(line, "Released:"));
      const relSeg = findLabelValueSeg(line, "Released:");
      if (relSeg) bb.released = toBBox(relSeg, line);
      const repoStr = findLabelValue(line, "Repositories:");
      if (repoStr) {
        header.repositories = repoStr.split("/");
        const repoSeg = findLabelValueSeg(line, "Repositories:");
        if (repoSeg) bb.repositories = toBBox(repoSeg, line);
      }
    }

    if (text.includes("Loan Number:")) {
      const loanNum = findLabelValue(line, "Loan Number:");
      // Avoid picking up "Reissued:" as the loan number
      header.loanNumber = loanNum.replace(/Reissued:.*/, "").trim();
      const lnSeg = findLabelValueSeg(line, "Loan Number:");
      if (lnSeg) bb.loanNumber = toBBox(lnSeg, line);
      header.reissued = parseDate(findLabelValue(line, "Reissued:"));
      const reiSeg = findLabelValueSeg(line, "Reissued:");
      if (reiSeg) bb.reissued = toBBox(reiSeg, line);
      const priceStr = findLabelValue(line, "Price:");
      header.price = parseCurrency(priceStr);
      const priceSeg = findLabelValueSeg(line, "Price:");
      if (priceSeg) bb.price = toBBox(priceSeg, line);
    }
  }

  return header;
}

// ── Borrower parsing ─────────────────────────────────────────────────────────

function parseBorrowerInfo(lines: TextLine[]): { borrower: BorrowerInfo; coBorrower: BorrowerInfo | null } {
  const bb: Record<string, BoundingBox> = {};
  const borrower: BorrowerInfo = { name: "", ssn: "", currentAddress: "", boundingBoxes: bb };
  let coBorrower: BorrowerInfo | null = null;
  let coBb: Record<string, BoundingBox> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = line.fullText;

    if (text.startsWith("Name") && line.segments.length >= 2) {
      borrower.name = line.segments[1]?.text.trim() ?? "";
      if (line.segments[1]) bb.name = toBBox(line.segments[1], line);
      // Check if there's a co-borrower name (4th segment or so)
      if (line.segments.length >= 4) {
        const coBorrowerName = line.segments[3]?.text.trim() ?? "";
        if (coBorrowerName && coBorrowerName !== "Name") {
          coBb = {};
          coBorrower = { name: coBorrowerName, ssn: "", currentAddress: "", boundingBoxes: coBb };
          if (line.segments[3]) coBb.name = toBBox(line.segments[3], line);
        }
      }
    }

    if (text.startsWith("SSN") && line.segments.length >= 2) {
      borrower.ssn = line.segments[1]?.text.trim() ?? "";
      if (line.segments[1]) bb.ssn = toBBox(line.segments[1], line);
      if (coBorrower && line.segments.length >= 4) {
        coBorrower.ssn = line.segments[3]?.text.trim() ?? "";
        if (line.segments[3]) coBb.ssn = toBBox(line.segments[3], line);
      }
    }

    if (text.startsWith("Current Address") && !borrower.currentAddress) {
      // Address is on the next line
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        if (!nextLine.fullText.includes("TransUnion") && !nextLine.fullText.includes("Credit Score")) {
          borrower.currentAddress = nextLine.segments[0]?.text.trim() ?? "";
          if (nextLine.segments[0]) bb.currentAddress = toBBox(nextLine.segments[0], nextLine);
          // Check for co-borrower address
          if (coBorrower && nextLine.segments.length >= 2) {
            coBorrower.currentAddress = nextLine.segments[1]?.text.trim() ?? "";
            if (nextLine.segments[1]) coBb.currentAddress = toBBox(nextLine.segments[1], nextLine);
          }
        }
      }
    }
  }

  return { borrower, coBorrower };
}

// ── Credit Scores ────────────────────────────────────────────────────────────

function parseCreditScores(sections: Section[]): CreditScoreEntry[] {
  const scoreSections = getSections(sections, "Credit Score Information");
  const scores: CreditScoreEntry[] = [];

  for (const section of scoreSections) {
    const lines = section.lines;
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const text = line.fullText.trim();

      // Skip header rows
      if (text.startsWith("Score") && text.includes("Name") && text.includes("Repository")) {
        i++;
        continue;
      }

      // Score entry: name in "Name" column (x~81), followed by repository info
      // The name line has the borrower name, repository, model, etc.
      if (line.segments.length >= 4 && line.segments[0].x > 50 && line.segments[0].x < 120) {
        const ebb: Record<string, BoundingBox> = {};
        const entry: CreditScoreEntry = {
          borrowerName: "",
          score: null,
          repository: "",
          model: "",
          developedBy: "",
          range: "",
          calculated: null,
          reportedOn: "",
          factors: [],
          boundingBoxes: ebb,
        };

        // Parse columns based on x-positions:
        // Name ~81, Repository ~193, Model ~243, DevelopedBy ~370, Range ~424, Calculated ~484, ReportedOn ~548
        for (const seg of line.segments) {
          const x = seg.x;
          const t = seg.text.trim();
          if (x < 120) { entry.borrowerName = t; ebb.borrowerName = toBBox(seg, line); }
          else if (x >= 120 && x < 230) {
            // Repository or combined "Repository Model"
            // Could be "TransUnion FICO Risk Score, Classic (04)" or just "Equifax"
            if (entry.repository) entry.repository += " " + t;
            else { entry.repository = t; ebb.repository = toBBox(seg, line); }
          }
          else if (x >= 230 && x < 360) {
            if (entry.model) entry.model += " " + t;
            else { entry.model = t; ebb.model = toBBox(seg, line); }
          }
          else if (x >= 360 && x < 420) { entry.developedBy = t; ebb.developedBy = toBBox(seg, line); }
          else if (x >= 420 && x < 480) { entry.range = t; ebb.range = toBBox(seg, line); }
          else if (x >= 480 && x < 540) { entry.calculated = parseDate(t); ebb.calculated = toBBox(seg, line); }
          else if (x >= 540) { entry.reportedOn = t; ebb.reportedOn = toBBox(seg, line); }
        }

        // If repository contains the model (e.g. "TransUnion FICO Risk Score, Classic (04)")
        // Split known bureau names
        const bureaus = ["TransUnion", "Experian", "Equifax"];
        for (const b of bureaus) {
          if (entry.repository.startsWith(b + " ")) {
            const rest = entry.repository.slice(b.length).trim();
            entry.repository = b;
            entry.model = rest + (entry.model ? " " + entry.model : "");
            break;
          }
          if (entry.repository === b) break;
        }

        i++;

        // Skip "Factors" line
        if (i < lines.length && lines[i].fullText.trim() === "Factors") {
          i++;
        }

        // Parse score and factors
        while (i < lines.length) {
          const fLine = lines[i];
          const fText = fLine.fullText.trim();

          // Stop conditions
          if (fText.startsWith("Score") && fText.includes("Repository")) break;
          if (isKnownSectionHeader(fText)) break;
          if (fText.startsWith("File Variation")) break;

          // Score line: starts with a number or "[ number ]" at x < 50
          if (fLine.segments[0]?.x < 50) {
            const scoreText = fLine.segments[0].text.trim().replace(/[\[\]]/g, "").trim();
            const scoreNum = parseInt(scoreText, 10);
            if (!isNaN(scoreNum)) {
              entry.score = scoreNum;
              ebb.score = toBBox(fLine.segments[0], fLine);
            }
            // Rest of line may contain first factor
            if (fLine.segments.length > 1) {
              const factorText = fLine.segments.slice(1).map(s => s.text).join(" ").trim();
              if (factorText.startsWith("*") || factorText.startsWith("\u2022")) {
                // Frozen or error text
                if (factorText !== "\u2022 -" && factorText !== "* -") {
                  entry.factors.push(factorText.replace(/^[\u2022*]\s*/, "").trim());
                }
              }
            }
          } else if (fText.startsWith("[ ") || fText.startsWith("[")) {
            // Score in brackets: "[ 656 ] * factor text"
            const bracketMatch = fText.match(/\[\s*(\d+)\s*\]/);
            if (bracketMatch) {
              entry.score = parseInt(bracketMatch[1], 10);
              if (fLine.segments[0]) ebb.score = toBBox(fLine.segments[0], fLine);
            }
            const afterBracket = fText.replace(/\[\s*\d+\s*\]\s*/, "").trim();
            if (afterBracket.startsWith("\u2022") || afterBracket.startsWith("*")) {
              const factor = afterBracket.replace(/^[\u2022*]\s*/, "").trim();
              if (factor && factor !== "-") entry.factors.push(factor);
            }
          } else if (fText === "Frozen") {
            // Bureau was frozen, no score
            entry.score = null;
          } else if (fText.startsWith("\u2022") || fText.startsWith("*")) {
            const factor = fText.replace(/^[\u2022*]\s*/, "").trim();
            if (factor && factor !== "-") entry.factors.push(factor);
          } else {
            break;
          }
          i++;
        }

        scores.push(entry);
        continue;
      }

      i++;
    }
  }

  return scores;
}

// ── Fraud Messages ───────────────────────────────────────────────────────────

function parseFraudMessages(sections: Section[]): FraudMessage[] {
  const msgs: FraudMessage[] = [];
  const fraudSections = [
    ...getSections(sections, "Fraud Messages"),
    ...getSections(sections, "Repository/Fraud Messages"),
  ];

  for (const section of fraudSections) {
    for (const line of section.lines) {
      const text = line.fullText.trim();
      if (text.startsWith("Date") && text.includes("Reported On")) continue;
      if (text === "*") continue;

      // Fraud message line: date at x~18, reportedOn at x~81, comment at x~142
      if (line.segments.length >= 3 && line.segments[0].x < 60) {
        const dateText = line.segments[0].text.trim();
        if (dateText.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
          const reportedOn = line.segments[1].text.trim();
          const comment = line.segments.slice(2).map(s => s.text.trim()).filter(t => t !== "*").join(" ");
          const mbb: Record<string, BoundingBox> = {};
          mbb.date = toBBox(line.segments[0], line);
          mbb.reportedOn = toBBox(line.segments[1], line);
          if (line.segments[2]) mbb.comment = toBBox(line.segments[2], line);
          msgs.push({
            date: parseDate(dateText),
            reportedOn,
            comment,
            boundingBoxes: mbb,
          });
        }
      }
    }
  }

  return msgs;
}

// ── Credit Summary ───────────────────────────────────────────────────────────

function parseCreditSummary(section: Section | null): CreditSummaryRow[] {
  if (!section) return [];
  const rows: CreditSummaryRow[] = [];

  const accountTypes = ["Mortgage", "Revolving/Credit Line", "Auto", "Education", "Other Installment", "Totals"];

  for (const line of section.lines) {
    const text = line.fullText.trim();
    const matchedType = accountTypes.find((t) => text.startsWith(t));
    if (!matchedType) continue;

    // Extract numbers from segments after the account type
    // Segments: type, numAccts, open, pastDue, mostRecentPastDue, payment, highCredit, balance, late, 30, 60, 90+
    const nums: string[] = [];
    const rbb: Record<string, BoundingBox> = {};
    let typeSeg: TextSegment | undefined;
    for (const seg of line.segments) {
      const t = seg.text.trim();
      if (t === matchedType) { typeSeg = seg; continue; }
      // Handle cases where two values are in one segment (e.g. "$5,381 $1,563,011")
      const parts = t.split(/\s+/).filter(Boolean);
      nums.push(...parts);
    }
    if (typeSeg) rbb.accountType = toBBox(typeSeg, line);

    rows.push({
      accountType: matchedType,
      numberOfAccounts: parseNum(nums[0] ?? ""),
      openAccounts: parseNum(nums[1] ?? ""),
      accountsCurrentlyPastDue: parseNum(nums[2] ?? ""),
      mostRecentPastDue: parseCurrency(nums[3] ?? ""),
      payment: parseCurrency(nums[4] ?? ""),
      highCredit: parseCurrency(nums[5] ?? ""),
      balance: parseCurrency(nums[6] ?? ""),
      lateAccounts: parseNum(nums[7] ?? ""),
      late30Days: parseNum(nums[8] ?? ""),
      late60Days: parseNum(nums[9] ?? ""),
      late90PlusDays: parseNum(nums[10] ?? ""),
      boundingBoxes: rbb,
    });
  }

  return rows;
}

// ── Credit Summary Stats ─────────────────────────────────────────────────────

function parseCreditSummaryStats(section: Section | null): CreditSummaryStats {
  const sbb: Record<string, BoundingBox> = {};
  const stats: CreditSummaryStats = {
    publicRecords: null,
    collectionsChargeOffs: null,
    bankruptcy: "",
    availableCredit: null,
    revolvingCreditLineUsed: "",
    inquiries: null,
    authorizedUserAccounts: null,
    totalDebtBalanceSecured: null,
    totalDebtBalanceUnsecured: null,
    totalHighCredit: null,
    utilizationPercent: "",
    revolvingUtilizationPercent: "",
    disputeCount: null,
    oldestTradeline: null,
    boundingBoxes: sbb,
  };

  if (!section) return stats;

  /** Return the value segment for a label-value pattern on a line. */
  const valSeg = (line: TextLine, idx: number, segText: string, label: string): TextSegment | undefined => {
    const after = segText.replace(label, "").trim();
    if (after) return line.segments[idx];
    return line.segments[idx + 1];
  };

  for (const line of section.lines) {
    const text = line.fullText;

    if (text.includes("Public Records:")) {
      for (let i = 0; i < line.segments.length; i++) {
        const seg = line.segments[i].text.trim();
        if (seg === "Public Records:" || seg.startsWith("Public Records:")) {
          const val = seg.replace("Public Records:", "").trim() || line.segments[i + 1]?.text.trim();
          stats.publicRecords = parseNum(val ?? "");
          const vs = valSeg(line, i, seg, "Public Records:");
          if (vs) sbb.publicRecords = toBBox(vs, line);
        }
        if (seg.startsWith("Available Credit:") || seg === "Available Credit:") {
          const val = seg.replace("Available Credit:", "").trim() || line.segments[i + 1]?.text.trim();
          stats.availableCredit = parseCurrency(val ?? "");
          const vs = valSeg(line, i, seg, "Available Credit:");
          if (vs) sbb.availableCredit = toBBox(vs, line);
        }
        if (seg.startsWith("Total Debt Balance secured:") || seg === "Total Debt Balance secured:") {
          const val = seg.replace("Total Debt Balance secured:", "").trim() || line.segments[i + 1]?.text.trim();
          stats.totalDebtBalanceSecured = parseCurrency(val ?? "");
          const vs = valSeg(line, i, seg, "Total Debt Balance secured:");
          if (vs) sbb.totalDebtBalanceSecured = toBBox(vs, line);
        }
        if (seg.startsWith("Utilization %:") || seg === "Utilization %:") {
          const val = seg.replace("Utilization %:", "").trim() || line.segments[i + 1]?.text.trim();
          stats.utilizationPercent = val ?? "";
          const vs = valSeg(line, i, seg, "Utilization %:");
          if (vs) sbb.utilizationPercent = toBBox(vs, line);
        }
      }
    }

    if (text.includes("Collections/Charge-offs:")) {
      for (let i = 0; i < line.segments.length; i++) {
        const seg = line.segments[i].text.trim();
        if (seg.startsWith("Collections/Charge-offs:") || seg === "Collections/Charge-offs:") {
          const val = seg.replace("Collections/Charge-offs:", "").trim() || line.segments[i + 1]?.text.trim();
          stats.collectionsChargeOffs = parseNum(val ?? "");
          const vs = valSeg(line, i, seg, "Collections/Charge-offs:");
          if (vs) sbb.collectionsChargeOffs = toBBox(vs, line);
        }
        if (seg.startsWith("Revolving/Credit Line Used:") || seg === "Revolving/Credit Line Used:") {
          const val = seg.replace("Revolving/Credit Line Used:", "").trim() || line.segments[i + 1]?.text.trim();
          stats.revolvingCreditLineUsed = val ?? "";
          const vs = valSeg(line, i, seg, "Revolving/Credit Line Used:");
          if (vs) sbb.revolvingCreditLineUsed = toBBox(vs, line);
        }
        if (seg.startsWith("Total Debt Balance unsecured:") || seg === "Total Debt Balance unsecured:") {
          const val = seg.replace("Total Debt Balance unsecured:", "").trim() || line.segments[i + 1]?.text.trim();
          stats.totalDebtBalanceUnsecured = parseCurrency(val ?? "");
          const vs = valSeg(line, i, seg, "Total Debt Balance unsecured:");
          if (vs) sbb.totalDebtBalanceUnsecured = toBBox(vs, line);
        }
        if (seg.startsWith("Revolving Utilization %:") || seg === "Revolving Utilization %:") {
          const val = seg.replace("Revolving Utilization %:", "").trim() || line.segments[i + 1]?.text.trim();
          stats.revolvingUtilizationPercent = val ?? "";
          const vs = valSeg(line, i, seg, "Revolving Utilization %:");
          if (vs) sbb.revolvingUtilizationPercent = toBBox(vs, line);
        }
      }
    }

    if (text.includes("Bankruptcy:")) {
      for (let i = 0; i < line.segments.length; i++) {
        const seg = line.segments[i].text.trim();
        if (seg.startsWith("Bankruptcy:") || seg === "Bankruptcy:") {
          const val = seg.replace("Bankruptcy:", "").trim() || line.segments[i + 1]?.text.trim();
          stats.bankruptcy = val ?? "";
          const vs = valSeg(line, i, seg, "Bankruptcy:");
          if (vs) sbb.bankruptcy = toBBox(vs, line);
        }
        if (seg.startsWith("Inquiries:") || seg === "Inquiries:") {
          const val = seg.replace("Inquiries:", "").trim() || line.segments[i + 1]?.text.trim();
          stats.inquiries = parseNum(val ?? "");
          const vs = valSeg(line, i, seg, "Inquiries:");
          if (vs) sbb.inquiries = toBBox(vs, line);
        }
        if (seg.startsWith("Total High Credit:") || seg === "Total High Credit:") {
          const val = seg.replace("Total High Credit:", "").trim() || line.segments[i + 1]?.text.trim();
          stats.totalHighCredit = parseCurrency(val ?? "");
          const vs = valSeg(line, i, seg, "Total High Credit:");
          if (vs) sbb.totalHighCredit = toBBox(vs, line);
        }
        if (seg.startsWith("Dispute Count:") || seg === "Dispute Count:") {
          const val = seg.replace("Dispute Count:", "").trim() || line.segments[i + 1]?.text.trim();
          stats.disputeCount = parseNum(val ?? "");
          const vs = valSeg(line, i, seg, "Dispute Count:");
          if (vs) sbb.disputeCount = toBBox(vs, line);
        }
      }
    }

    if (text.includes("Authorized User Accounts:")) {
      for (let i = 0; i < line.segments.length; i++) {
        const seg = line.segments[i].text.trim();
        if (seg.startsWith("Authorized User Accounts:") || seg === "Authorized User Accounts:") {
          const val = seg.replace("Authorized User Accounts:", "").trim() || line.segments[i + 1]?.text.trim();
          stats.authorizedUserAccounts = parseNum(val ?? "");
          const vs = valSeg(line, i, seg, "Authorized User Accounts:");
          if (vs) sbb.authorizedUserAccounts = toBBox(vs, line);
        }
        if (seg.startsWith("Oldest Tradeline:") || seg === "Oldest Tradeline:") {
          const val = seg.replace("Oldest Tradeline:", "").trim() || line.segments[i + 1]?.text.trim();
          stats.oldestTradeline = parseDate(val ?? "");
          const vs = valSeg(line, i, seg, "Oldest Tradeline:");
          if (vs) sbb.oldestTradeline = toBBox(vs, line);
        }
      }
    }
  }

  return stats;
}

// ── Credit History (Tradelines) ──────────────────────────────────────────────

function parseTradelines(sections: Section[]): Tradeline[] {
  const tradelines: Tradeline[] = [];
  const historySections = getSections(sections, "Credit History");

  for (const section of historySections) {
    const lines = section.lines;
    let i = 0;

    // Skip header rows (can appear multiple times due to page breaks)
    // We'll skip them inline during tradeline parsing instead
    // (handled below)

    // Parse tradeline entries
    while (i < lines.length) {
      const line = lines[i];
      const text = line.fullText.trim();

      // Skip legend/footer lines and repeated column header rows
      if (
        text.startsWith("Whose:") ||
        text.startsWith("ECOA:") ||
        text.startsWith("Account Type:") ||
        text.startsWith("W E Creditor") ||
        text.startsWith("h C") ||
        (text === "o O") ||
        text.startsWith("s A Acct") ||
        (text.startsWith("e") && text.includes("Limit"))
      ) {
        i++;
        continue;
      }

      // A tradeline entry starts with whose+ecoa code (e.g. "B C LOANDEPO.CO") at x~20
      // The line has: W E CreditorName, dates, amounts, late counts, status
      if (line.segments.length >= 5 && line.segments[0].x < 30) {
        const firstSeg = line.segments[0].text.trim();
        // Pattern: 1-2 chars whose + space + 1-2 chars ecoa + space + creditor name
        const headerMatch = firstSeg.match(/^([A-Z])\s+([A-Z])\s+(.+)$/);
        if (!headerMatch) {
          i++;
          continue;
        }

        const tbb: Record<string, BoundingBox> = {};
        const tradeline: Tradeline = {
          whose: headerMatch[1],
          ecoa: headerMatch[2],
          creditorName: headerMatch[3],
          dateReported: null,
          dateOpened: null,
          highCredit: null,
          balance: null,
          pastDue: null,
          monthsReviewed: null,
          late30: null,
          late60: null,
          late90Plus: null,
          accountStatus: "",
          accountNumber: "",
          dla: null,
          creditLimit: null,
          terms: "",
          maximumDelinquency: "",
          accountType: "",
          description: "",
          reportedOn: "",
          address: "",
          boundingBoxes: tbb,
        };

        // The first segment contains whose+ecoa+creditorName
        tbb.creditorName = toBBox(line.segments[0], line);

        // Parse the rest of the main line using x-position buckets:
        // dates (x~170-240), highCredit (x~270-340), balance (x~340-400),
        // pastDue (x~400-435), monthsRev (x~435-460), late30 (x~460-482),
        // late60 (x~482-505), late90+status (x~505+)
        //
        // Note: when balance is $0, the segment may be omitted entirely.
        // We detect this by checking if there's a gap between highCredit and pastDue.
        let gotBalance = false;
        for (let s = 1; s < line.segments.length; s++) {
          const seg = line.segments[s];
          const t = seg.text.trim();
          const x = seg.x;

          if (x >= 170 && x < 240) {
            const dateParts = t.split(/\s+/);
            tradeline.dateReported = parseDate(dateParts[0] ?? "");
            tradeline.dateOpened = parseDate(dateParts[1] ?? "");
            tbb.dateReported = toBBox(seg, line);
          } else if (x >= 270 && x < 340) {
            tradeline.highCredit = parseCurrency(t);
            tbb.highCredit = toBBox(seg, line);
          } else if (x >= 340 && x < 400) {
            tradeline.balance = parseCurrency(t);
            gotBalance = true;
            tbb.balance = toBBox(seg, line);
          } else if (x >= 400 && x < 435) {
            tradeline.pastDue = parseCurrency(t);
            tbb.pastDue = toBBox(seg, line);
          } else if (x >= 435 && x < 460) {
            tradeline.monthsReviewed = parseNum(t);
            tbb.monthsReviewed = toBBox(seg, line);
          } else if (x >= 460 && x < 482) {
            tradeline.late30 = parseNum(t);
            tbb.late30 = toBBox(seg, line);
          } else if (x >= 482 && x < 505) {
            tradeline.late60 = parseNum(t);
            tbb.late60 = toBBox(seg, line);
          } else if (x >= 505) {
            const statusMatch = t.match(/^(\d+)\s+(.+)$/);
            if (statusMatch) {
              tradeline.late90Plus = parseNum(statusMatch[1]);
              tradeline.accountStatus = statusMatch[2].trim();
            } else {
              tradeline.accountStatus = t;
            }
            tbb.accountStatus = toBBox(seg, line);
          }
        }

        // If balance was never populated but we have other fields, assume $0
        if (!gotBalance && tradeline.highCredit !== null) {
          tradeline.balance = 0;
        }

        i++;

        // Line 2: account number, DLA, credit limit, terms, account type
        if (i < lines.length) {
          const line2 = lines[i];
          const text2 = line2.fullText.trim();
          // First segment at x~40 is account number
          if (line2.segments.length >= 1 && line2.segments[0].x > 25 && line2.segments[0].x < 60) {
            tradeline.accountNumber = line2.segments[0].text.trim().replace(/^-/, "");
            tbb.accountNumber = toBBox(line2.segments[0], line2);

            for (let s = 1; s < line2.segments.length; s++) {
              const seg = line2.segments[s];
              const t = seg.text.trim();
              const x = seg.x;

              if (x >= 210 && x < 270) {
                tradeline.dla = parseDate(t);
                tbb.dla = toBBox(seg, line2);
              } else if (x >= 270 && x < 340) {
                tradeline.creditLimit = parseCurrency(t);
                tbb.creditLimit = toBBox(seg, line2);
              } else if (x >= 340 && x < 510) {
                // Terms like "360M/$2571" or "MIN $287"
                tradeline.terms = t;
                tbb.terms = toBBox(seg, line2);
              } else if (x >= 510) {
                tradeline.accountType = t;
                tbb.accountType = toBBox(seg, line2);
              }
            }
            i++;
          }
        }

        // Line 3: description + reportedOn
        if (i < lines.length) {
          const line3 = lines[i];
          if (line3.segments.length >= 1 && line3.segments[0].x > 25 && line3.segments[0].x < 60) {
            tradeline.description = line3.segments[0].text.trim();
            tbb.description = toBBox(line3.segments[0], line3);
            if (line3.segments.length >= 2) {
              const roSeg = line3.segments[line3.segments.length - 1];
              tradeline.reportedOn = roSeg.text.trim();
              tbb.reportedOn = toBBox(roSeg, line3);
            }
            i++;
          }
        }

        // Line 4: address
        if (i < lines.length) {
          const line4 = lines[i];
          if (line4.segments.length >= 1 && line4.segments[0].x > 25 && line4.segments[0].x < 60) {
            const addrText = line4.fullText.trim();
            // Check this looks like an address (contains dash-separated parts)
            if (addrText.includes(" - ") || addrText.match(/\d{5}/)) {
              tradeline.address = addrText;
              tbb.address = toBBox(line4.segments[0], line4);
              i++;
            }
          }
        }

        tradelines.push(tradeline);
        continue;
      }

      i++;
    }
  }

  return tradelines;
}

// ── Inquiries ────────────────────────────────────────────────────────────────

function parseInquiries(sections: Section[]): Inquiry[] {
  const inquiries: Inquiry[] = [];
  const inqSections = [
    ...getSections(sections, "Inquiries (Last 120 Days)"),
    ...getSections(sections, "Inquiries (continued)"),
  ];

  for (const section of inqSections) {
    let i = 0;
    const lines = section.lines;

    while (i < lines.length) {
      const line = lines[i];
      const text = line.fullText.trim();

      // Skip header rows
      if (text.startsWith("Date") && text.includes("Name")) {
        i++;
        continue;
      }

      // Inquiry line starts with a date at x~18-19
      if (line.segments.length >= 2 && line.segments[0].x < 30) {
        const dateText = line.segments[0].text.trim();
        if (!dateText.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
          i++;
          continue;
        }

        const ibb: Record<string, BoundingBox> = {};
        const inquiry: Inquiry = {
          date: parseDate(dateText),
          name: "",
          subscriberCode: "",
          reportedOn: "",
          ecoa: "",
          type: "",
          boundingBoxes: ibb,
        };
        ibb.date = toBBox(line.segments[0], line);

        // Parse segments by x position:
        // name x~129, subscriberCode x~210, reportedOn x~306, ecoa x~402, type x~498
        for (let s = 1; s < line.segments.length; s++) {
          const seg = line.segments[s];
          const t = seg.text.trim();
          const x = seg.x;

          if (x >= 100 && x < 200) {
            // Name — may include subscriber code if concatenated
            const parts = t.split(/,\s*/);
            if (parts.length >= 2 && parts[parts.length - 1].match(/^\d/)) {
              inquiry.name = parts.slice(0, -1).join(", ");
              inquiry.subscriberCode = parts[parts.length - 1];
            } else {
              inquiry.name = t;
            }
            ibb.name = toBBox(seg, line);
          } else if (x >= 200 && x < 290) {
            inquiry.subscriberCode = t;
            ibb.subscriberCode = toBBox(seg, line);
          } else if (x >= 290 && x < 390) {
            inquiry.reportedOn = t;
            ibb.reportedOn = toBBox(seg, line);
          } else if (x >= 390 && x < 490) {
            inquiry.ecoa = t;
            ibb.ecoa = toBBox(seg, line);
          } else if (x >= 490) {
            inquiry.type = inquiry.type ? inquiry.type + " " + t : t;
            if (!ibb.type) ibb.type = toBBox(seg, line);
          }
        }

        i++;

        // Continuation lines (e.g. "LLC" at x~129, "Companies" at x~498)
        while (i < lines.length) {
          const contLine = lines[i];
          if (contLine.segments[0]?.x < 30 && contLine.segments[0]?.text.trim().match(/^\d{2}\/\d{2}\/\d{4}$/)) break;
          if (contLine.segments[0]?.x < 100) break;
          if (isKnownSectionHeader(contLine.fullText.trim())) break;

          // Append continuation text
          for (const seg of contLine.segments) {
            const t = seg.text.trim();
            const x = seg.x;
            if (x >= 100 && x < 200) {
              inquiry.name += " " + t;
            } else if (x >= 490) {
              inquiry.type += " " + t;
            }
          }
          i++;
        }

        inquiry.name = inquiry.name.trim();
        inquiry.type = inquiry.type.trim();
        inquiries.push(inquiry);
        continue;
      }

      i++;
    }
  }

  return inquiries;
}

// ── Public Records ───────────────────────────────────────────────────────────

function parsePublicRecords(section: Section | null): PublicRecord[] {
  if (!section) return [];
  const records: PublicRecord[] = [];

  for (const line of section.lines) {
    const text = line.fullText.trim();
    if (text.includes("REPORTING BUREAU CERTIFIES")) continue;
    if (text.includes("records search firm")) continue;
    if (text.includes("PUBLIC RECORDS LEARNED:")) {
      if (!text.includes("NONE")) {
        const prbb: Record<string, BoundingBox> = {};
        if (line.segments[0]) prbb.text = toBBox(line.segments[0], line);
        records.push({ text: text.replace("PUBLIC RECORDS LEARNED:", "").trim(), boundingBoxes: prbb });
      }
      continue;
    }
    if (text && !text.startsWith("THE ")) {
      const prbb: Record<string, BoundingBox> = {};
      if (line.segments[0]) prbb.text = toBBox(line.segments[0], line);
      records.push({ text, boundingBoxes: prbb });
    }
  }

  return records;
}

// ── Repository Files ─────────────────────────────────────────────────────────

function parseRepositoryFiles(section: Section | null): RepositoryFile[] {
  if (!section) return [];
  const files: RepositoryFile[] = [];
  let current: RepositoryFile | null = null;
  let rfbb: Record<string, BoundingBox> = {};

  for (const line of section.lines) {
    const text = line.fullText.trim();

    // New bureau entry: "TUC-B1  TransUnion - Pulled: 09/15/2025 - Infile Date: 04/16/2021"
    const bureauMatch = text.match(/^(TUC-B\d|EXP-B\d|EQX-B\d)/);
    if (bureauMatch || (line.segments.length >= 2 && line.segments[0].x < 30 && line.segments[0].text.trim().match(/^(TUC|EXP|EQX)/))) {
      if (current) files.push(current);

      const bureau = line.segments[0].text.trim();
      const rest = line.segments.slice(1).map(s => s.text).join(" ").trim();

      const nameMatch = rest.match(/^(TransUnion|Experian|Equifax)/);
      const pulledMatch = rest.match(/Pulled:\s*(\d{2}\/\d{2}\/\d{4})/);
      const infileMatch = rest.match(/Infile Date:\s*(\d{2}\/\d{2}\/\d{4})/);

      rfbb = {};
      rfbb.bureau = toBBox(line.segments[0], line);
      if (line.segments[1]) rfbb.bureauName = toBBox(line.segments[1], line);

      current = {
        bureau,
        bureauName: nameMatch ? nameMatch[1] : "",
        pulled: pulledMatch ? parseDate(pulledMatch[1]) : null,
        infileDate: infileMatch ? parseDate(infileMatch[1]) : null,
        names: [],
        ssn: "",
        dob: "",
        addresses: [],
        employers: [],
        akas: [],
        boundingBoxes: rfbb,
      };
      continue;
    }

    if (!current) continue;

    // NM: line
    if (text.startsWith("NM:")) {
      const nmText = text.slice(3).trim();
      const ssnMatch = nmText.match(/SSN:\s*(\d{3}-\d{2}-\d{4})/);
      const dobMatch = nmText.match(/DOB:\s*(.+)$/);
      const name = nmText.replace(/SSN:.*/, "").trim();
      current.names.push(name);
      if (line.segments[0] && !rfbb.names) rfbb.names = toBBox(line.segments[0], line);
      if (ssnMatch) current.ssn = ssnMatch[1];
      if (dobMatch) current.dob = dobMatch[1].trim();
    }

    // AKA: line
    if (text.startsWith("AKA:")) {
      current.akas.push(text.slice(4).trim());
    }

    // ADDRESS: line
    if (text.startsWith("ADDRESS:")) {
      current.addresses.push(text.slice(8).trim());
      if (line.segments[0] && !rfbb.addresses) rfbb.addresses = toBBox(line.segments[0], line);
    }

    // EM: line (employer)
    if (text.startsWith("EM:")) {
      current.employers.push(text.slice(3).trim());
    }
  }

  if (current) files.push(current);
  return files;
}

// ── Creditors ────────────────────────────────────────────────────────────────

function parseCreditors(section: Section | null): Creditor[] {
  if (!section) return [];
  const creditors: Creditor[] = [];
  let i = 0;
  const lines = section.lines;

  while (i < lines.length) {
    const line = lines[i];
    const text = line.fullText.trim();

    // Creditor entry starts with "+"
    if (text.startsWith("+")) {
      const cbb: Record<string, BoundingBox> = {};
      const creditor: Creditor = {
        name: "",
        code: "",
        address: "",
        phone: "",
        boundingBoxes: cbb,
      };

      // Name is first segment, code is second
      const nameText = line.segments[0].text.trim().replace(/^\+\s*/, "");
      creditor.name = nameText;
      cbb.name = toBBox(line.segments[0], line);
      if (line.segments.length >= 2) {
        creditor.code = line.segments[1].text.trim();
        cbb.code = toBBox(line.segments[1], line);
      }

      i++;

      // Next line is address + phone
      if (i < lines.length) {
        const addrLine = lines[i];
        if (!addrLine.fullText.trim().startsWith("+")) {
          creditor.address = addrLine.segments[0]?.text.trim() ?? "";
          if (addrLine.segments[0]) cbb.address = toBBox(addrLine.segments[0], addrLine);
          if (addrLine.segments.length >= 2) {
            const lastSeg = addrLine.segments[addrLine.segments.length - 1];
            const lastSegText = lastSeg.text.trim();
            if (lastSegText.match(/\d{3}-\d{3}-\d{4}/) || lastSegText === "nullnull") {
              creditor.phone = lastSegText === "nullnull" ? "" : lastSegText;
              if (creditor.phone) cbb.phone = toBBox(lastSeg, addrLine);
            }
          }
          i++;
        }
      }

      creditors.push(creditor);
      continue;
    }

    i++;
  }

  return creditors;
}

// ── Main parser ──────────────────────────────────────────────────────────────

export function parseXactusFromLines(rawLines: TextLine[]): XactusCreditReport {
  // Format fingerprint check — "xactus" is in the logo image so may not appear in text.
  // Check for distinctive Xactus patterns: Broomall PA address, FICO + Repositories, section headers.
  const head = rawLines.slice(0, 40).map((l) => l.fullText).join("\n").toLowerCase();
  const isXactus =
    head.includes("xactus") ||
    head.includes("credit report x") ||
    head.includes("broomall, pa") ||
    (head.includes("fico") && head.includes("repositories")) ||
    head.includes("credit score information") ||
    head.includes("credit history");
  if (!isXactus) {
    throw new UnrecognizedFormatError(
      "Xactus",
      "document does not match Xactus Credit Report X format"
    );
  }

  const lines = deduplicateLines(rawLines);
  const sections = splitIntoSections(lines);

  // The header+borrower info is in lines before the first real section
  const headerSection = sections.find(s => s.name === "Header");
  const headerLines = headerSection?.lines ?? lines.slice(0, 20);

  const header = parseHeader(headerLines);
  const { borrower, coBorrower } = parseBorrowerInfo(headerLines);

  const creditScores = parseCreditScores(sections);
  const fraudMessages = parseFraudMessages(sections);

  const summarySection = getSection(sections, "Credit Summary");
  const creditSummary = parseCreditSummary(summarySection);
  const creditSummaryStats = parseCreditSummaryStats(summarySection);

  const tradelines = parseTradelines(sections);
  const inquiries = parseInquiries(sections);
  const publicRecords = parsePublicRecords(getSection(sections, "Public Records"));
  const repositoryFiles = parseRepositoryFiles(getSection(sections, "Repository Files Returned"));
  const creditors = parseCreditors(getSection(sections, "Creditors"));

  // Required section validation
  if (!borrower.name) {
    throw new MissingSectionError("Xactus", "borrower.name");
  }

  return {
    header,
    borrower,
    coBorrower,
    creditScores,
    fraudMessages,
    creditSummary,
    creditSummaryStats,
    tradelines,
    inquiries,
    publicRecords,
    repositoryFiles,
    creditors,
  };
}

export async function parseXactusCreditReport(buffer: Buffer): Promise<XactusCreditReport> {
  const rawLines = await extractLines(buffer);
  return parseXactusFromLines(rawLines);
}
