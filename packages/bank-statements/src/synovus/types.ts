import type { DateString, BoundingBox } from "@parseo/shared";

export type { DateString, BoundingBox } from "@parseo/shared";

export interface SynovusStatement {
  accountHolder: AccountHolder;
  accountNumber: string;
  accountType: string;
  statementPeriod: { start: DateString; end: DateString };
  summary: AccountSummary;
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

export interface AccountSummary {
  beginningBalance: number;
  depositsCredits: number;
  withdrawalsDebits: number;
  endingBalance: number;
  lowBalance: number;
  averageBalance: number;
  averageCollectedBalance: number;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface Check {
  date: DateString;
  checkNumber: string;
  amount: number;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface Transaction {
  date: DateString;
  transactionType: string;
  description: string;
  amount: number;
  type: "deposit" | "withdrawal";
  boundingBoxes: Record<string, BoundingBox>;
}
