import type { DateString, DateRange, BoundingBox } from "@parseo/shared";

export type { DateString, DateRange } from "@parseo/shared";

// ── Report sections ──────────────────────────────────────────────────────────

export interface ReportHeader {
  clientName: string;
  clientCode: string;
  ordered: DateString;
  released: DateString;
  reissued: DateString;
  reportId: string;
  repositories: string[];
  price: number | null;
  loanNumber: string;
  requestedBy: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface BorrowerInfo {
  name: string;
  ssn: string;
  currentAddress: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface CreditScoreEntry {
  borrowerName: string;
  score: number | null;
  repository: string;
  model: string;
  developedBy: string;
  range: string;
  calculated: DateString;
  reportedOn: string;
  factors: string[];
  boundingBoxes: Record<string, BoundingBox>;
}

export interface FraudMessage {
  date: DateString;
  reportedOn: string;
  comment: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface CreditSummaryRow {
  accountType: string;
  numberOfAccounts: number | null;
  openAccounts: number | null;
  accountsCurrentlyPastDue: number | null;
  mostRecentPastDue: number | null;
  payment: number | null;
  highCredit: number | null;
  balance: number | null;
  lateAccounts: number | null;
  late30Days: number | null;
  late60Days: number | null;
  late90PlusDays: number | null;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface CreditSummaryStats {
  publicRecords: number | null;
  collectionsChargeOffs: number | null;
  bankruptcy: string;
  availableCredit: number | null;
  revolvingCreditLineUsed: string;
  inquiries: number | null;
  authorizedUserAccounts: number | null;
  totalDebtBalanceSecured: number | null;
  totalDebtBalanceUnsecured: number | null;
  totalHighCredit: number | null;
  utilizationPercent: string;
  revolvingUtilizationPercent: string;
  disputeCount: number | null;
  oldestTradeline: DateString;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface Tradeline {
  whose: string;
  ecoa: string;
  creditorName: string;
  dateReported: DateString;
  dateOpened: DateString;
  highCredit: number | null;
  balance: number | null;
  pastDue: number | null;
  monthsReviewed: number | null;
  late30: number | null;
  late60: number | null;
  late90Plus: number | null;
  accountStatus: string;
  accountNumber: string;
  dla: DateString;
  creditLimit: number | null;
  terms: string;
  maximumDelinquency: string;
  accountType: string;
  description: string;
  reportedOn: string;
  address: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface Inquiry {
  date: DateString;
  name: string;
  subscriberCode: string;
  reportedOn: string;
  ecoa: string;
  type: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface PublicRecord {
  text: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface RepositoryFile {
  bureau: string;
  bureauName: string;
  pulled: DateString;
  infileDate: DateString;
  names: string[];
  ssn: string;
  dob: string;
  addresses: string[];
  employers: string[];
  akas: string[];
  boundingBoxes: Record<string, BoundingBox>;
}

export interface Creditor {
  name: string;
  code: string;
  address: string;
  phone: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Full report ──────────────────────────────────────────────────────────────

export interface XactusCreditReport {
  header: ReportHeader;
  borrower: BorrowerInfo;
  coBorrower: BorrowerInfo | null;
  creditScores: CreditScoreEntry[];
  fraudMessages: FraudMessage[];
  creditSummary: CreditSummaryRow[];
  creditSummaryStats: CreditSummaryStats;
  tradelines: Tradeline[];
  inquiries: Inquiry[];
  publicRecords: PublicRecord[];
  repositoryFiles: RepositoryFile[];
  creditors: Creditor[];
}
