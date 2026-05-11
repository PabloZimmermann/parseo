import type { DateString, BoundingBox } from "@parseo/shared";

export type { DateString, BoundingBox } from "@parseo/shared";

export interface RelayStatement {
  accountHolder: AccountHolder;
  accountNumber: string;
  accountName: string;
  statementPeriod: { from: DateString; to: DateString };
  summary: StatementSummary;
  totalDeposits: number;
  totalWithdrawals: number;
  transactions: Transaction[];
  boundingBoxes: Record<string, BoundingBox>;
}

export interface AccountHolder {
  name: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface StatementSummary {
  openingBalance: number;
  closingBalance: number;
  deposits: number;
  withdrawals: number;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface Transaction {
  date: DateString;
  description: string;
  type: string;
  status: string;
  amount: number;
  balance: number;
  boundingBoxes: Record<string, BoundingBox>;
}
