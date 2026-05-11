import type { DateString, BoundingBox } from "@parseo/shared";

export type { DateString, BoundingBox } from "@parseo/shared";

export interface PNCStatement {
  accountHolder: AccountHolder;
  accountNumber: string;
  accountType: string;
  statementPeriod: { start: DateString; end: DateString };
  summary: BalanceSummary;
  checks: Check[];
  transactions: Transaction[];
  totalDeposits: number;
  totalWithdrawals: number;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface AccountHolder {
  name: string;
  address: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface BalanceSummary {
  beginningBalance: number;
  depositsAndAdditions: number;
  checksAndDeductions: number;
  endingBalance: number;
  averageLedger: number;
  averageCollected: number;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface Check {
  date: DateString;
  checkNumber: string;
  amount: number;
  referenceNumber: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface Transaction {
  date: DateString;
  description: string;
  amount: number;
  type: "deposit" | "withdrawal";
  category: string;
  referenceNumber: string;
  boundingBoxes: Record<string, BoundingBox>;
}
