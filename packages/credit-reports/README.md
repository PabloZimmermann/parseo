# @parseo/credit-reports

Deterministic PDF parsers for credit reports. Supports Xactus, PCB, and CreditXpert formats.

## Installation

```bash
npm install @parseo/credit-reports
```

## Usage

### Individual parsers

```typescript
import { xactus, pcb, creditxpert } from "@parseo/credit-reports";

const report = await xactus(buffer);     // XactusCreditReport
const report = await pcb(buffer);        // PCBCreditReport
const report = await creditxpert(buffer); // CreditXpertReport
```

### Auto-detect format

```typescript
import { parseCreditReport } from "@parseo/credit-reports";

const result = await parseCreditReport(buffer);
// { format: "xactus", report: XactusCreditReport }
```

| Provider | Import name |
|---|---|
| Xactus "Credit Report X" | `xactus` |
| Premium Credit Bureau (PCB) | `pcb` |
| CreditXpert (score-only) | `creditxpert` |

## Data conventions

- **Dates**: ISO 8601 strings (`"2024-08-31"`) or `null`
- **Currency**: Plain numbers (`54961.89`, not `"$54,961.89"`)
- **Bounding boxes**: `{ x, y, width, height, pageNumber }` on every extracted field

## License

MIT
