# @parseo/core

Universal document parser for underwriting PDFs. Auto-classifies the document and routes to the correct parser.

## Installation

```bash
npm install @parseo/core
```

This installs all Parseo parsers (credit reports, background checks, appraisals, bank statements).

## Usage

```typescript
import { parse } from "@parseo/core";

const result = await parse(buffer);

if (result) {
  result.format;       // "chase", "xactus", "smartlinx", etc.
  result.data;         // Parsed document (type depends on format)
  result.confidence;   // Classifier confidence score
  result.skippedPages; // Number of intro pages stripped
}
```

`parse()` handles text extraction, classification, page skipping, and bounding box offset correction. Returns `null` if no known format is detected.

## License

MIT
