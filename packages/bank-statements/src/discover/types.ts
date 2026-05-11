import type { DateString, BoundingBox } from "@parseo/shared";

export type { DateString, BoundingBox } from "@parseo/shared";

export interface DiscoverStatement {
  accountHolder: AccountHolder;
  accountNumber: string;
  accountType: string;
  statementPeriod: { start: DateString; end: DateString };
  summary: AccountSummary;
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
  depositsAndCredits: number;
  checks: number;
  atmAndDebitCardWithdrawals: number;
  electronicWithdrawals: number;
  serviceCharges: number;
  endingBalance: number;
  apyEarned: number;
  interestThisPeriod: number;
  interestYTD: number;
  daysInPeriod: number;
  averageDailyBalance: number;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface Transaction {
  date: DateString;
  systemDate: DateString;
  description: string;
  amount: number;
  type: "deposit" | "withdrawal";
  category: string;
  boundingBoxes: Record<string, BoundingBox>;
}
