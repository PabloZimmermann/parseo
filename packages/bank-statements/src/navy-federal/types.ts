import type { DateString, BoundingBox } from "@parseo/shared";

export type { DateString, BoundingBox } from "@parseo/shared";

export interface NavyFederalStatement {
  accountHolder: AccountHolder;
  accessNumber: string;
  statementPeriod: { from: DateString; to: DateString };
  accounts: Account[];
  totalDeposits: number;
  totalWithdrawals: number;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface AccountHolder {
  name: string;
  address: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface Account {
  accountType: string;
  accountNumber: string;
  summary: AccountSummary;
  transactions: Transaction[];
  boundingBoxes: Record<string, BoundingBox>;
}

export interface AccountSummary {
  previousBalance: number;
  depositsCredits: number;
  withdrawalsDebits: number;
  endingBalance: number;
  ytdDividends: number;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface Transaction {
  date: DateString;
  description: string;
  amount: number;
  balance: number | null;
  boundingBoxes: Record<string, BoundingBox>;
}
