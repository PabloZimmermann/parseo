import type { BoundingBox } from "@parseo/shared";

/** MM/DD/YYYY or MM/YYYY or similar date string */
export type DateString = string;

// ── Report Header ──

export interface ReportHeader {
  fileNumber: string;
  fnmaNumber: string;
  dateCompleted: DateString;
  dateOrdered: DateString;
  sendTo: string;
  customerNumber: string;
  repositories: string;
  preparedBy: string;
  requestedBy: string;
  price: number | null;
  loanType: string;
  refNumber: string;
  propertyAddress: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Applicant ──

export interface ApplicantInfo {
  name: string;
  ssn: string;
  dob: string;
  currentAddress: string;
  currentAddressLength: string;
  previousAddress: string;
  previousAddressLength: string;
  maritalStatus: string;
  dependents: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Score Models ──

export interface ScoreFactor {
  code: string;
  description: string;
}

export interface ScoreModel {
  bureau: string;
  modelName: string;
  applicantName: string;
  ssn: string;
  score: number | null;
  factors: ScoreFactor[];
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Public Records ──

export interface PublicRecord {
  rawText: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Trended Data ──

export interface TrendedData {
  months: string[];
  scheduled: (number | null)[];
  actual: (number | null)[];
  balance: (number | null)[];
}

// ── Account (tradeline) ──

export interface Account {
  ecoa: string;
  whose: string;
  creditor: string;
  dateReported: DateString;
  dateOpened: DateString;
  highCreditOrLimit: number | null;
  balance: number | null;
  pastDue: number | null;
  monthsReviewed: number | null;
  late30: number | null;
  late60: number | null;
  late90Plus: number | null;
  status: string;
  accountNumber: string;
  dla: DateString;
  accountType: string;
  terms: string;
  source: string;
  history: string;
  description: string;
  trended: TrendedData | null;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Inquiry ──

export interface Inquiry {
  bureau: string;
  whose: string;
  date: DateString;
  creditor: string;
  type: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Credit Bureau Error ──

export interface CreditBureauError {
  rawText: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Full Report ──

export interface PCBCreditReport {
  header: ReportHeader;
  applicant: ApplicantInfo;
  coApplicant: ApplicantInfo | null;
  creditBureauErrors: CreditBureauError[];
  scoreModels: ScoreModel[];
  publicRecords: PublicRecord[];
  derogatoryAccounts: Account[];
  accountsWithBalance: Account[];
  accountsWithNoBalance: Account[];
  realEstateAccounts: Account[];
  inquiries: Inquiry[];
}
