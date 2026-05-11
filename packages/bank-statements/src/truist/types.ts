import type { DateString, BoundingBox } from "@parseo/shared";

export type { DateString, BoundingBox } from "@parseo/shared";

export interface TruistStatement {
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
  previousBalance: number;
  totalChecks: number;
  totalOtherWithdrawals: number;
  totalDepositsCredits: number;
  newBalance: number;
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
  description: string;
  amount: number;
  type: "deposit" | "withdrawal";
  boundingBoxes: Record<string, BoundingBox>;
}
