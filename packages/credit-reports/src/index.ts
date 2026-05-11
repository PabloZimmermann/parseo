// Individual parsers
import { parseXactusCreditReport } from "./xactus/index.js";
import { parsePCBReport } from "./pcb/index.js";
import { parseCreditXpertReport } from "./creditxpert/index.js";
export const xactus = parseXactusCreditReport;
export const pcb = parsePCBReport;
export const creditxpert = parseCreditXpertReport;

// Unified router (auto-detects format, handles combined PDFs)
export { parseCreditReport, parseCreditReportFromLines } from "./router.js";

// Unified Textract adapter (auto-detects + bounding boxes)
export { parseCreditReportForTextract } from "./textract.js";

// Per-format Textract adapters
export { parseXactusForTextract } from "./xactus/index.js";
export { parsePCBForTextract } from "./pcb/index.js";
export { parseCreditXpertForTextract } from "./creditxpert/index.js";

// Types
export type { XactusCreditReport } from "./xactus/index.js";
export type { PCBCreditReport } from "./pcb/index.js";
export type { CreditXpertReport } from "./creditxpert/index.js";
export type { CreditReportFormat, CreditReportResult } from "./router.js";
export type { CreditReportTextractResult } from "./textract.js";
export type { TextractResult } from "./xactus/index.js";
