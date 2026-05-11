import type { DateString, BoundingBox } from "@parseo/shared";

export type { DateString, BoundingBox } from "@parseo/shared";

export interface CitibankStatement {
  accountHolder: AccountHolder;
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
  beginningBalance: number;
  endingBalance: number;
  totalDebits: number;
  totalCredits: number;
  transactions: Transaction[];
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
