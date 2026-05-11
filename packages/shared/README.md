# @parseo/shared

PDF text extraction, document classifier, error classes, and shared utilities for Parseo parsers.

## Installation

```bash
npm install @parseo/shared
```

## Usage

### Text extraction

```typescript
import { extractLines } from "@parseo/shared";

const lines = await extractLines(buffer);
// TextLine[] with text, position, page number, and bounding boxes
```

### Document classification

```typescript
import { classifyDocument } from "@parseo/shared";

const result = classifyDocument(lines);
// { format: "chase", startPage: 1, skip: 0, confidence: 28 }

// Limit to a specific package scope
classifyDocument(lines, "bank-statements");
classifyDocument(lines, "credit-reports");
```

### Error classes

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

### Parsing utilities

```typescript
import { parseDate, parseCurrency, parseNum, parseDateRange } from "@parseo/shared";

parseDate("08/31/2024");   // "2024-08-31"
parseCurrency("$1,234.56"); // 1234.56
```

## License

MIT
