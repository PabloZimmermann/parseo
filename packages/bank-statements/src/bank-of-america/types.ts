import type { DateString, BoundingBox } from "@parseo/shared";

export type { DateString, BoundingBox } from "@parseo/shared";

export interface BankOfAmericaStatement {
  accountHolder: AccountHolder;
  accountNumber: string;
  accountType: string;
  statementPeriod: { from: DateString; to: DateString };
  summary: StatementSummary;
  transactions: Transaction[];
  checks: Check[];
  dailyBalances: DailyBalance[];
  boundingBoxes: Record<string, BoundingBox>;
}

export interface AccountHolder {
  name: string;
  address: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface StatementSummary {
  beginningBalance: number;
  totalDeposits: number;
  totalWithdrawals: number;
  checks: number;
  serviceFees: number;
  endingBalance: number;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface Transaction {
  date: DateString;
  description: string;
  amount: number;
  category: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface Check {
  date: DateString;
  checkNumber: string;
  amount: number;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface DailyBalance {
  date: DateString;
  balance: number;
}
