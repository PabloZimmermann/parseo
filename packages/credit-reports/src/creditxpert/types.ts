import type { BoundingBox } from "@parseo/shared";

// ── CreditXpert report output ──────────────────────────────────────────────

export interface BureauScore {
  bureau: string; // "TransUnion" | "Experian" | "Equifax"
  currentScore: number | null;
  potentialScore: number | null;
  scoreImprovement: number | null;
  ordered: boolean;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface CreditXpertSettings {
  availableCash: number | null;
  timeframe: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface CreditXpertReport {
  applicantName: string;
  coApplicantName: string;
  scores: BureauScore[];
  settings: CreditXpertSettings;
  boundingBoxes: Record<string, BoundingBox>;
}
