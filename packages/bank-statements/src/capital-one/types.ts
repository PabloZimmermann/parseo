import type { DateString, BoundingBox } from "@parseo/shared";

export type { DateString, BoundingBox } from "@parseo/shared";

export interface CapitalOneStatement {
  accountHolder: AccountHolder;
  accountNumber: string;
  accountName: string;
  jointWith: string | null;
  statementPeriod: { start: DateString; end: DateString };
  summary: StatementSummary;
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

export interface StatementSummary {
  openingBalance: number;
  closingBalance: number;
  interestEarned: number;
  totalFees: number;
  apy: number;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface Transaction {
  date: DateString;
  description: string;
  category: string | null;
  amount: number;
  balance: number;
  boundingBoxes: Record<string, BoundingBox>;
}
