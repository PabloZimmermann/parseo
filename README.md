# Parseo

Deterministic PDF parsers for underwriting documents. Each parser accepts a `Buffer` and returns structured, typed JSON with bounding boxes for every extracted field. No file I/O — the consuming application handles reading files.

## Packages

| Package | Description |
|---|---|
| `@parseo/core` | Universal `parse(buffer)` — auto-classifies and routes to the correct parser |
| `@parseo/shared` | PDF text extraction, classifier, error classes, and shared utilities |
| `@parseo/credit-reports` | Xactus, PCB, and CreditXpert credit report parsers |
| `@parseo/background-checks` | LexisNexis SmartLinx person report parser |
| `@parseo/appraisals` | Richer Values, Form 1004MC (URAR), and Form 1073 (Condo) parsers |
| `@parseo/bank-statements` | 14 bank statement parsers (see below) |

## Installation

```bash
# Universal (includes all parsers)
npm install @parseo/core

# Or install individual packages
npm install @parseo/shared @parseo/bank-statements @parseo/credit-reports @parseo/appraisals @parseo/background-checks
```

## Quick Start

```typescript
import { parse } from "@parseo/core";

const result = await parse(buffer);

if (result) {
  result.format;      // "chase", "credit-report", "smartlinx", etc.
  result.data;        // Parsed statement/report (type depends on format)
  result.confidence;  // Classifier confidence score
  result.skippedPages; // Number of intro pages stripped
}
```

`parse()` handles everything: text extraction, classification, page skipping, and bounding box offset correction. Returns `null` if no known format is detected.

## Classifier

For more control, use the classifier directly via `@parseo/shared`:

```typescript
import { extractLines, classifyDocument } from "@parseo/shared";

const lines = await extractLines(buffer);
const result = classifyDocument(lines);
// { format: "chase", startPage: 1, skip: 0, confidence: 28 }
```

Use the optional `scope` parameter to limit classification to a single package:

```typescript
classifyDocument(lines, "bank-statements");
classifyDocument(lines, "credit-reports");
classifyDocument(lines, "appraisals");
classifyDocument(lines, "background-checks");
```

Returns `null` if no format is detected.

## Bank Statements

```typescript
import { chase, wellsFargo, pnc } from "@parseo/bank-statements";

const statement = await chase(buffer);
// statement.accountHolder, statement.transactions, statement.summary, etc.
```

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

All bank statement parsers return a consistent shape:

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

## Credit Reports

```typescript
import { xactus, pcb, creditxpert } from "@parseo/credit-reports";

const report = await xactus(buffer);    // XactusCreditReport
const report = await pcb(buffer);       // PCBCreditReport
const report = await creditxpert(buffer); // CreditXpertReport
```

| Provider | Import name |
|---|---|
| Xactus "Credit Report X" | `xactus` |
| Premium Credit Bureau (PCB) | `pcb` |
| CreditXpert (score-only) | `creditxpert` |

## Background Checks

```typescript
import { smartlinx } from "@parseo/background-checks";

const report = await smartlinx(buffer); // SmartLinxReport
```

## Appraisals

```typescript
import { richerValues, form1004MC, form1073 } from "@parseo/appraisals";

const report = await richerValues(buffer); // RicherValuesReport
const report = await form1004MC(buffer);   // Form1004MCReport
const report = await form1073(buffer);     // Form1073Report
```

## Error Handling

All parsers throw typed errors that extend `ParserError`:

```typescript
import {
  ParserError,
  InvalidPDFError,
  UnrecognizedFormatError,
  MissingSectionError,
  ExtractionError,
} from "@parseo/shared";
```

| Error | When |
|---|---|
| `InvalidPDFError` | Buffer is empty, not a PDF, or encrypted |
| `UnrecognizedFormatError` | PDF text doesn't match expected provider |
| `MissingSectionError` | Format matched but required field missing |
| `ExtractionError` | No extractable text (scanned image) |

## Data Conventions

- **Dates**: ISO 8601 strings (`"2024-08-31"`) or `null`
- **Currency**: Plain numbers (`54961.89`, not `"$54,961.89"`)
- **Bounding boxes**: `{ x, y, width, height, pageNumber }` on every extracted field
- **Withdrawals**: Negative amounts on transactions

## Project Structure

```
packages/
  core/                → @parseo/core
  shared/              → @parseo/shared
  credit-reports/      → @parseo/credit-reports
  background-checks/   → @parseo/background-checks
  appraisals/          → @parseo/appraisals
  bank-statements/     → @parseo/bank-statements
    src/
      chase/
      wells-fargo/
      bank-of-america/
      td-bank/
      pnc/
      truist/
      capital-one/
      citibank/
      navy-federal/
      relay/
      grove-bank/
      third-federal/
      discover/
      synovus/
```

- npm workspaces at root — `npm install` links everything
- TypeScript project references — `npm run build` compiles in dependency order
- Each package builds to `dist/` with declarations
