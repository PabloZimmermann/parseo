# @parseo/bank-statements

Deterministic PDF parsers for bank statements. Supports 14 banks.

## Installation

```bash
npm install @parseo/bank-statements
```

## Usage

```typescript
import { chase, wellsFargo, pnc } from "@parseo/bank-statements";

const statement = await chase(buffer);
// statement.accountHolder, statement.transactions, statement.summary, etc.
```

## Supported banks

| Bank | Import name | Account types |
|---|---|---|
| Chase | `chase` | Business Checking |
| Wells Fargo | `wellsFargo` | Business Checking |
| Bank of America | `bankOfAmerica` | Business Advantage |
| TD Bank | `tdBank` | Business Checking |
| PNC | `pnc` | Business Checking |
| Truist | `truist` | Simple Business Checking |
| Capital One | `capitalOne` | 360 Performance Savings |
| Citibank | `citibank` | Checking, Savings |
| Navy Federal | `navyFederal` | Business Checking, Savings |
| Relay | `relay` | Business Checking |
| Grove Bank | `groveBank` | Business Checking |
| Third Federal | `thirdFederal` | HELOC |
| Discover | `discover` | Money Market |
| Synovus | `synovus` | Pro Business Checking |

## Return shape

All parsers return a consistent structure:

```typescript
interface Statement {
  accountHolder: { name: string; address: string; boundingBoxes: Record<string, BoundingBox> };
  accountNumber: string;
  accountType: string;
  statementPeriod: { start: DateString; end: DateString };
  summary: { /* bank-specific fields */ };
  transactions: Transaction[];
  totalDeposits: number;
  totalWithdrawals: number;
  boundingBoxes: Record<string, BoundingBox>;
}
```

## Data conventions

- **Dates**: ISO 8601 strings (`"2024-08-31"`) or `null`
- **Currency**: Plain numbers (`54961.89`, not `"$54,961.89"`)
- **Withdrawals**: Negative amounts on transactions
- **Bounding boxes**: `{ x, y, width, height, pageNumber }` on every extracted field

## License

MIT
