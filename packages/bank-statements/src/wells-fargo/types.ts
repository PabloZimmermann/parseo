import type { DateString, BoundingBox } from "@parseo/shared";

export type { DateString, BoundingBox } from "@parseo/shared";

export interface WellsFargoStatement {
  accountHolder: AccountHolder;
  accountNumber: string;
  accountType: string;
  statementDate: DateString;
  statementPeriod: { from: DateString; to: DateString };
  summary: StatementSummary;
  totalDeposits: number;
  totalWithdrawals: number;
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
  depositsCredits: number;
  withdrawalsDebits: number;
  endingBalance: number;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface Transaction {
  date: DateString;
  checkNumber: string;
  description: string;
  depositsCredits: number | null;
  withdrawalsDebits: number | null;
  endingDailyBalance: number | null;
  boundingBoxes: Record<string, BoundingBox>;
}
