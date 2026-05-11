import type { TextLine } from "./types.js";

// ── Public types ──────────────────────────────────────────────

export type FormatName =
  | "smartlinx"
  | "credit-report"
  | "richer-values"
  | "form-1004mc"
  | "form-1073"
  | "wells-fargo"
  | "td-bank"
  | "chase"
  | "bank-of-america"
  | "navy-federal"
  | "third-federal"
  | "citibank"
  | "relay"
  | "grove-bank"
  | "capital-one"
  | "truist"
  | "pnc"
  | "discover"
  | "synovus";

export interface ClassifyResult {
  /** Which parser family to use */
  format: FormatName;
  /** 1-based page number where the recognised content starts */
  startPage: number;
  /** Number of intro pages to strip (startPage − 1) */
  skip: number;
  /** Internal score — higher means more patterns matched */
  confidence: number;
}

// ── Format profiles ───────────────────────────────────────────

interface FormatProfile {
  name: FormatName;
  /** At least one must match for the format to be considered */
  primary: RegExp[];
  /** Extra patterns that boost score (disambiguation) */
  supporting: RegExp[];
  /** If any of these match on the same page, disqualify this format */
  exclude: RegExp[];
}

const profiles: FormatProfile[] = [
  // ── Form 1004 (URAR) ─────────────────────────────────────
  {
    name: "form-1004mc",
    primary: [
      /Uniform Residential Appraisal Report/i,
      /Fannie Mae Form 1004\b/i,
      /Freddie Mac Form 70\b/i,
      /Form 1004\s*UAD/i,
    ],
    supporting: [
      /Neighborhood Name/i,
      /One-Unit Housing Trends/i,
      /One-Unit Housing/i,
      /PUD\s+HOA/i,
      /Units\s+One\s+One with Accessory Unit/i,
      /Type\s+Det\.\s+Att\./i,
      /Finished area above grade contains/i,
      /COST APPROACH TO VALUE/i,
      /PROJECT INFORMATION FOR PUDs/i,
    ],
    exclude: [
      /Individual Condominium Unit Appraisal Report/i,
      /Form 1073/i,
    ],
  },

  // ── Form 1073 (Condo) ────────────────────────────────────
  {
    name: "form-1073",
    primary: [
      /Individual Condominium Unit Appraisal Report/i,
      /Fannie Mae Form 1073/i,
      /Freddie Mac Form 465/i,
      /Form 1073/i,
    ],
    supporting: [
      /Unit\s*#/i,
      /Project Name/i,
      /Condominium Unit Housing Trends/i,
      /Condominium Housing/i,
      /PROJECT SITE/i,
      /# of Elevators/i,
      /conversion of existing building/i,
      /HOA Mo\.\s*Assessment/i,
      /Floor Location/i,
    ],
    exclude: [
      /Uniform Residential Appraisal Report/i,
    ],
  },

  // ── Richer Values (Renovation Analysis) ───────────────────
  {
    name: "richer-values",
    primary: [
      /Renovation Analysis/i,
      /richervalues\.com/i,
    ],
    supporting: [
      /Valuation Summary and Parameters/i,
      /Hyper-Local Neighborhood/i,
      /Budget Assessment/i,
      /Estimated Valuation.*ARV/i,
      /Distance-Based Comps/i,
      /Renovation Strategies/i,
      /Estimated As Is Market Value/i,
      /Estimated ARV at Target Condition/i,
    ],
    exclude: [],
  },

  // ── Credit Reports (CreditXpert, PCB, Xactus) ────────────
  {
    name: "credit-report",
    primary: [
      /CreditXpert/i,
      /MERGED INFILE CREDIT REPORT/i,
      /PREMIUM CREDIT BUREAU/i,
      /370 Reed Rd/i,
      /800-243-0120/,
      /Broomall,?\s*PA/i,
      /Order Verifications/i,
    ],
    supporting: [
      /FICO/i,
      /Credit Summary/i,
      /Credit Score Information/i,
      /Credit History/i,
      /Repositories.*(?:TUC|EXP|EQX)/i,
      /Current score.*Potential score/i,
      /ECOA KEY/i,
      /SCORE MODELS/i,
      /Client Code/i,
      /Report ID/i,
      /EQUIFAX|TRANSUNION|EXPERIAN/i,
    ],
    exclude: [],
  },

  // ── Wells Fargo (Bank Statements) ─────────────────────────
  {
    name: "wells-fargo",
    primary: [
      /Wells\s*Fargo/i,
      /wellsfargo\.com/i,
    ],
    supporting: [
      /Statement period activity summary/i,
      /Transaction history/i,
      /Beginning balance on/i,
      /Ending balance on/i,
      /Account number:/i,
      /Business Checking/i,
      /Monthly service fee summary/i,
      /1-800-CALL-WELLS/i,
    ],
    exclude: [],
  },

  // ── Chase (Bank Statements) ───────────────────────────────
  {
    name: "chase",
    primary: [
      /JPMorgan Chase/i,
      /Chase\.com/i,
      /CHASE\b/,
    ],
    supporting: [
      /CHECKING SUMMARY/i,
      /DEPOSITS AND ADDITIONS/i,
      /ELECTRONIC WITHDRAWALS/i,
      /ATM & DEBIT CARD/i,
      /DAILY ENDING BALANCE/i,
      /Chase Business Complete/i,
      /1-800-242-7338/,
      /Account Number:/i,
    ],
    exclude: [],
  },

  // ── TD Bank (Bank Statements) ─────────────────────────────
  {
    name: "td-bank",
    primary: [
      /TD\s*Bank/i,
      /tdbank\.com/i,
    ],
    supporting: [
      /STATEMENT OF ACCOUNT/i,
      /ACCOUNT SUMMARY/i,
      /DAILY ACCOUNT ACTIVITY/i,
      /Beginning Balance/i,
      /Ending Balance/i,
      /Primary Account #/i,
      /Average Collected Balance/i,
      /1-800-937-2000/,
    ],
    exclude: [],
  },

  // ── Bank of America (Bank Statements) ─────────────────────
  {
    name: "bank-of-america",
    primary: [
      /Bank of America/i,
      /bankofamerica\.com/i,
      /bofa\.com/i,
    ],
    supporting: [
      /Beginning balance on/i,
      /Ending balance on/i,
      /Deposits and other credits/i,
      /Withdrawals and other debits/i,
      /Daily ledger balance/i,
      /Service fees/i,
      /Business Advantage/i,
      /Account number:/i,
    ],
    exclude: [],
  },

  // ── Navy Federal (Bank Statements) ────────────────────────
  {
    name: "navy-federal",
    primary: [
      /Navy Federal/i,
      /navyfederal\.org/i,
    ],
    supporting: [
      /Statement of Account/i,
      /Access No\./i,
      /Summary of your deposit accounts/i,
      /Business Checking/i,
      /Mbr Business Savings/i,
      /1-888-842-6328/,
      /NCUA/i,
      /Routing Number:/i,
    ],
    exclude: [],
  },

  // ── Relay (Bank Statements) ────────────────────────────────
  {
    name: "relay",
    primary: [
      /relayfi\.com/i,
      /Relay Financials/i,
    ],
    supporting: [
      /Thread Bank/i,
      /Account Statement/i,
      /Owners:/i,
      /Opening Balance.*Closing Balance/i,
      /1-888-205-9304/,
      /Routing Number:/i,
    ],
    exclude: [],
  },

  // ── Citibank (Bank Statements) ─────────────────────────────
  {
    name: "citibank",
    primary: [
      /Citibank/i,
      /CitiBusiness/i,
      /CITIBANK,\s*N\.\s*A\./i,
    ],
    supporting: [
      /CHECKING ACTIVITY/i,
      /SAVINGS ACTIVITY/i,
      /Beginning Balance:/i,
      /Ending Balance:/i,
      /SERVICE CHARGE SUMMARY/i,
      /Citibusiness Service Center/i,
      /877.*528.*0990/,
      /Relationship Summary/i,
    ],
    exclude: [],
  },

  // ── Third Federal (HELOC Statements) ──────────────────────
  {
    name: "third-federal",
    primary: [
      /Third Federal/i,
      /thirdfederal\.com/i,
      /THIRD FEDERAL SAVINGS/i,
    ],
    supporting: [
      /Equity Line of Credit Statement/i,
      /Statement Closing Date/i,
      /Credit Line/i,
      /Principal Balance/i,
      /Principal Amount/i,
      /Finance Charge Calculation Summary/i,
      /1-877-552-5659/,
      /Account Summary/i,
      /Payment Summary/i,
    ],
    exclude: [],
  },

  // ── PNC (Bank Statements) ─────────────────────────────────
  {
    name: "pnc",
    primary: [
      /PNC Bank/i,
      /pnc\.com/i,
    ],
    supporting: [
      /Business Checking/i,
      /Balance Summary/i,
      /Activity Detail/i,
      /Deposits and Other Additions/i,
      /Checks and Other Deductions/i,
      /1-877-287-2654/,
      /Pittsburgh, PA/i,
      /Member FDIC/i,
    ],
    exclude: [],
  },

  // ── Truist (Bank Statements) ──────────────────────────────
  {
    name: "truist",
    primary: [
      /Truist/i,
      /4TRUIST/,
      /Truist\.com/i,
    ],
    supporting: [
      /SIMPLE BUSINESS CHECKING/i,
      /Account summary/i,
      /Your previous balance/i,
      /Your new balance/i,
      /Deposits, credits and interest/i,
      /Other withdrawals, debits/i,
      /844.*487.*8478/,
      /MEMBER FDIC/i,
    ],
    exclude: [],
  },

  // ── Capital One (Bank Statements) ─────────────────────────
  {
    name: "capital-one",
    primary: [
      /Capital One/i,
      /capitalone\.com/i,
    ],
    supporting: [
      /360 Performance Savings/i,
      /STATEMENT PERIOD/i,
      /TOTAL ENDING BALANCE/i,
      /IN ALL ACCOUNTS/i,
      /Account Summary/i,
      /Cashflow Summary/i,
      /1-888-464-0727/,
      /P\.O\. Box 85123/i,
    ],
    exclude: [],
  },

  // ── Grove Bank (Bank Statements) ──────────────────────────
  {
    name: "grove-bank",
    primary: [
      /Grove\s*Bank/i,
      /grovebankandtrust\.com/i,
    ],
    supporting: [
      /CHECKING ACCOUNTS/i,
      /Business Checking/i,
      /Statement Dates/i,
      /Previous Balance/i,
      /Current Balance/i,
      /Deposits\/Credits/i,
      /Checks\/Debits/i,
      /305-858-6666/,
      /MEMBER FDIC/i,
    ],
    exclude: [],
  },

  // ── Discover (Bank Statements) ─────────────────────────────
  {
    name: "discover",
    primary: [
      /\bDiscover\b/,
      /Discover\.com/i,
    ],
    supporting: [
      /MONEY MARKET/i,
      /ACCOUNT SUMMARY/i,
      /ACCOUNT ACTIVITY/i,
      /1-800-347-7000/,
      /Deposits and Credits/i,
      /Electronic Withdrawals/i,
      /Annual Percentage Yield Earned/i,
      /Interest Earned This Period/i,
      /Salt Lake City, UT/i,
    ],
    exclude: [],
  },

  // ── Synovus (Bank Statements) ──────────────────────────────
  {
    name: "synovus",
    primary: [
      /P\.O\.\s*Box\s*2646/i,
      /888-796-6887/,
    ],
    supporting: [
      /Statement of Account/i,
      /Pro Business Checking/i,
      /Other Debits/i,
      /Deposits\/Other Credits/i,
      /Columbus,?\s*GA/i,
      /Balance Summary/i,
      /Direct inquiries to/i,
    ],
    exclude: [],
  },

  // ── SmartLinx (LexisNexis) ────────────────────────────────
  {
    name: "smartlinx",
    primary: [
      /SmartLinx/i,
      /LexisNexis Risk Management/i,
    ],
    supporting: [
      /Person Report/i,
      /Search Terms:\s*SSN/i,
      /Report created for/i,
      /SSN Summary/i,
      /Address Summary/i,
      /Criminal Filings/i,
      /Bankruptcy Filings/i,
      /Judgment\s*[&/]\s*Lien Filings/i,
      /Person Summary/i,
      /LexID/i,
      /At a Glance/i,
    ],
    exclude: [],
  },
];

// ── Package → format mapping ─────────────────────────────────

export type PackageName =
  | "credit-reports"
  | "bank-statements"
  | "background-checks"
  | "appraisals";

const PACKAGE_FORMATS: Record<PackageName, FormatName[]> = {
  "credit-reports": ["credit-report"],
  "background-checks": ["smartlinx"],
  "appraisals": ["richer-values", "form-1004mc", "form-1073"],
  "bank-statements": [
    "wells-fargo",
    "td-bank",
    "chase",
    "bank-of-america",
    "navy-federal",
    "third-federal",
    "citibank",
    "relay",
    "grove-bank",
    "capital-one",
    "truist",
    "pnc",
    "discover",
    "synovus",
  ],
};

// ── Classifier ────────────────────────────────────────────────

/** Maximum number of leading pages to scan before giving up */
const MAX_SCAN_PAGES = 5;

/**
 * Examine the extracted text lines page-by-page and determine which parser
 * to use and how many intro pages to skip.
 *
 * @param scope — optional package name to limit classification to formats
 *   belonging to that package (e.g. `"bank-statements"`, `"credit-reports"`).
 *
 * Returns `null` if no known format is detected in the first N pages.
 */
export function classifyDocument(
  lines: TextLine[],
  scope?: PackageName,
): ClassifyResult | null {
  const pages = [...new Set(lines.map((l) => l.page))].sort((a, b) => a - b);
  const scopeSet = scope ? new Set(PACKAGE_FORMATS[scope]) : null;

  for (const page of pages.slice(0, MAX_SCAN_PAGES)) {
    const pageText = lines
      .filter((l) => l.page === page)
      .map((l) => l.fullText)
      .join("\n");

    let best: { profile: FormatProfile; score: number } | null = null;

    for (const profile of profiles) {
      if (scopeSet && !scopeSet.has(profile.name)) continue;
      if (profile.exclude.some((rx) => rx.test(pageText))) continue;

      const primaryHits = profile.primary.filter((rx) =>
        rx.test(pageText),
      ).length;
      if (primaryHits === 0) continue;

      const supportHits = profile.supporting.filter((rx) =>
        rx.test(pageText),
      ).length;

      const score = primaryHits * 10 + supportHits;

      if (!best || score > best.score) {
        best = { profile, score };
      }
    }

    if (best) {
      return {
        format: best.profile.name,
        startPage: page,
        skip: page - 1,
        confidence: best.score,
      };
    }
  }

  return null;
}
