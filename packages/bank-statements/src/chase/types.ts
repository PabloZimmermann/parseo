import type { DateString, BoundingBox } from "@parseo/shared";

export type { DateString, BoundingBox } from "@parseo/shared";

export interface ChaseStatement {
  accountHolder: AccountHolder;
  accountNumber: string;
  accountType: string;
  statementPeriod: { from: DateString; to: DateString };
  summary: CheckingSummary;
  transactions: Transaction[];
  dailyEndingBalances: DailyBalance[];
  boundingBoxes: Record<string, BoundingBox>;
}

export interface AccountHolder {
  name: string;
  address: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface CheckingSummary {
  beginningBalance: number;
  endingBalance: number;
  depositsAndAdditions: SummaryLine;
  checksPaid: SummaryLine;
  atmDebitCardWithdrawals: SummaryLine;
  electronicWithdrawals: SummaryLine;
  fees: SummaryLine;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface SummaryLine {
  instances: number;
  amount: number;
}

export interface Transaction {
  date: DateString;
  description: string;
  amount: number;
  category: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface DailyBalance {
  date: DateString;
  balance: number;
}
