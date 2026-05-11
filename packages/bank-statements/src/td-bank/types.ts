import type { DateString, BoundingBox } from "@parseo/shared";

export type { DateString, BoundingBox } from "@parseo/shared";

export interface TDBankStatement {
  accountHolder: AccountHolder;
  accountNumber: string;
  accountType: string;
  statementPeriod: { from: DateString; to: DateString };
  summary: StatementSummary;
  transactions: Transaction[];
  boundingBoxes: Record<string, BoundingBox>;
}

export interface AccountHolder {
  name: string;
  address: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface StatementSummary {
  beginningBalance: number;
  endingBalance: number;
  averageCollectedBalance: number | null;
  interestEarnedThisPeriod: number | null;
  interestPaidYearToDate: number | null;
  annualPercentageYieldEarned: string;
  daysInPeriod: number | null;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface Transaction {
  date: DateString;
  description: string;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  boundingBoxes: Record<string, BoundingBox>;
}
