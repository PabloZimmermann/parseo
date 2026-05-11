// Individual parsers
import { parseXactusCreditReport } from "./xactus/index.js";
import { parsePCBReport } from "./pcb/index.js";
import { parseCreditXpertReport } from "./creditxpert/index.js";
export const xactus = parseXactusCreditReport;
export const pcb = parsePCBReport;
export const creditxpert = parseCreditXpertReport;

// Unified router (auto-detects format, handles combined PDFs)
export { parseCreditReport, parseCreditReportFromLines } from "./router.js";

// Types
export type { XactusCreditReport } from "./xactus/index.js";
export type { PCBCreditReport } from "./pcb/index.js";
export type { CreditXpertReport } from "./creditxpert/index.js";
export type { CreditReportFormat, CreditReportResult } from "./router.js";
