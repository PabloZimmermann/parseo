# @parseo/background-checks

Deterministic PDF parser for LexisNexis SmartLinx person reports.

## Installation

```bash
npm install @parseo/background-checks
```

## Usage

```typescript
import { smartlinx } from "@parseo/background-checks";

const report = await smartlinx(buffer); // SmartLinxReport
```

The parser extracts person summaries, addresses, associates, licenses, property records, and court/legal records.

## Data conventions

- **Dates**: ISO 8601 strings (`"2024-08-31"`) or `null`
- **Currency**: Plain numbers (`54961.89`, not `"$54,961.89"`)
- **Bounding boxes**: `{ x, y, width, height, pageNumber }` on every extracted field

## License

MIT
