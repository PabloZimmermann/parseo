import type { DateString, BoundingBox } from "@parseo/shared";

export type { DateString, BoundingBox } from "@parseo/shared";

export interface SpaceCoastStatement {
  bankName: string;
  accountHolder: AccountHolder;
  memberNumber: string;
  statementPeriod: { from: DateString; to: DateString };
  documentDate: DateString;
  accounts: Account[];
  boundingBoxes: Record<string, BoundingBox>;
}

export interface AccountHolder {
  name: string;
  type: "entity" | "individual";
  address: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface Account {
  accountType: string;
  accountNumber: string;
  summary: AccountSummary;
  transactions: Transaction[];
  checksCleared: ClearedCheck[];
  totalChecksPaid: number;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface AccountSummary {
  beginningBalance: number;
  endingBalance: number;
  totalDepositsAndAdditions: number;
  totalMoneyOut: number;
  totalServiceCharges: number;
  daysInPeriod: number;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface Transaction {
  date: DateString;
  effectiveDate: DateString;
  description: string;
  amount: number;
  type: "deposit" | "withdrawal";
  balance: number | null;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface ClearedCheck {
  checkNumber: string;
  amount: number;
  boundingBoxes: Record<string, BoundingBox>;
}
