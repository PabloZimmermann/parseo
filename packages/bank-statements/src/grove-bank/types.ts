import type { DateString, BoundingBox } from "@parseo/shared";

export type { DateString, BoundingBox } from "@parseo/shared";

export interface GroveBankStatement {
  accountHolder: AccountHolder;
  accountNumber: string;
  accountType: string;
  statements: MonthlyStatement[];
  totalDeposits: number;
  totalWithdrawals: number;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface AccountHolder {
  name: string;
  address: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface MonthlyStatement {
  statementDate: DateString;
  statementPeriod: { start: DateString; end: DateString };
  summary: AccountSummary;
  transactions: Transaction[];
  boundingBoxes: Record<string, BoundingBox>;
}

export interface AccountSummary {
  previousBalance: number;
  depositsCredits: number;
  checksDebits: number;
  serviceCharge: number;
  interestPaid: number;
  currentBalance: number;
  daysInPeriod: number;
  averageLedger: number;
  averageCollected: number;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface Transaction {
  date: DateString;
  description: string;
  amount: number;
  type: "deposit" | "withdrawal";
  boundingBoxes: Record<string, BoundingBox>;
}
