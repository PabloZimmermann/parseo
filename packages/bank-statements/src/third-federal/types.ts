import type { DateString, BoundingBox } from "@parseo/shared";

export type { DateString, BoundingBox } from "@parseo/shared";

export interface ThirdFederalStatement {
  accountHolder: AccountHolder;
  accountNumber: string;
  accountType: string;
  statements: MonthlyStatement[];
  totalDeposits: number;
  totalWithdrawals: number;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface AccountHolder {
  name: string;
  address: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface MonthlyStatement {
  closingDate: DateString;
  previousStatementDate: DateString;
  summary: AccountSummary;
  paymentSummary: PaymentSummary;
  transactions: Transaction[];
  boundingBoxes: Record<string, BoundingBox>;
}

export interface AccountSummary {
  previousBalance: number;
  advancesAndDebits: number;
  paymentsAndCredits: number;
  newBalance: number;
  creditLimit: number;
  availableCredit: number;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface PaymentSummary {
  unpaidAmount: number;
  principal: number;
  financeCharges: number;
  otherCharges: number;
  fees: number;
  lateCharges: number;
  minimumPayment: number;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface Transaction {
  date: DateString;
  description: string;
  amount: number | null;
  principalAmount: number | null;
  principalBalance: number | null;
  boundingBoxes: Record<string, BoundingBox>;
}
