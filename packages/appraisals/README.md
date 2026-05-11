# @parseo/appraisals

Deterministic PDF parsers for appraisal reports. Supports Richer Values, Form 1004-MC (URAR), and Form 1073 (Condo).

## Installation

```bash
npm install @parseo/appraisals
```

## Usage

```typescript
import { richerValues, form1004MC, form1073 } from "@parseo/appraisals";

const report = await richerValues(buffer); // RicherValuesReport
const report = await form1004MC(buffer);   // Form1004MCReport
const report = await form1073(buffer);     // Form1073Report
```

| Format | Import name |
|---|---|
| Richer Values | `richerValues` |
| Form 1004-MC (URAR) | `form1004MC` |
| Form 1073 (Condo) | `form1073` |

## Data conventions

- **Dates**: ISO 8601 strings (`"2024-08-31"`) or `null`
- **Currency**: Plain numbers (`54961.89`, not `"$54,961.89"`)
- **Bounding boxes**: `{ x, y, width, height, pageNumber }` on every extracted field

## License

MIT
