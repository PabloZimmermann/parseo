import type { DateString, BoundingBox } from "@parseo/shared";

export type { DateString, BoundingBox } from "@parseo/shared";

// ── Cover Page (Page 1) ─────────────────────────────────────────────────────

export interface CoverPage {
  reportType: string;
  address: string;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  propertyType: string;
  effectiveDate: DateString;
  preparedFor: {
    name: string;
    address: string;
  };
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Valuation Summary and Parameters (Pages 2-4) ────────────────────────────

export interface ValuationCommentary {
  hyperLocalNeighborhood: string;
  subjectPropertyAssessment: string;
  budgetAssessment: string;
  budgetFlags: string;
  estimatedValuation: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface PropertyDataSourceRow {
  source: string;
  above: number | null;
  below: number | null;
  total: number | null;
  beds: number | null;
  baths: number | null;
  stories: number | null;
  year: number | null;
  lot: number | null;
  garage: number | null;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface SubjectPropertyDetails {
  address: string;
  apn: string;
  comparisonMetrics: string;
  currentUse: {
    type: string;
    sqft: number | null;
    beds: number | null;
    baths: number | null;
    yearBuilt: number | null;
    acres: number | null;
  };
  percentile: {
    sqft: string;
    beds: string;
    baths: string;
    yearBuilt: string;
    acres: string;
  };
  projectedUse: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface ComparableSearchParameters {
  distanceBasedComps: string;
  sizeBasedComps: string;
  additionalComps: string;
  customCompSearch: string;
  additionalAnalyses: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface Neighborhood {
  landUseTypesPresent: string;
  landUseConcerns: string;
  averageAgeOfResidentialUnits: string;
  averageBuildingCondition: string;
  averageBuildingQuality: string;
  soldCompPercentRemodeled: string;
  zoning: string;
  floodMapNumber: string;
  floodMapEffectiveDate: string;
  isInFloodZone: string;
  isInSpecialFloodHazard: string;
  conformanceIssues: string;
  ownership: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface PreparedBy {
  name: string;
  email: string;
  phone: string;
  date: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface ValuationSummaryAndParameters {
  commentary: ValuationCommentary;
  propertyDataSources: PropertyDataSourceRow[];
  subjectPropertyDetails: SubjectPropertyDetails;
  comparableSearchParameters: ComparableSearchParameters;
  verificationOfCondition: string;
  listingHistory: string;
  neighborhood: Neighborhood;
  preparedBy: PreparedBy;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Valuation Results (Page 5) ───────────────────────────────────────────────

export interface ValuationResults {
  currentCondition: string;
  estimatedAsIsMarketValue: number | null;
  borrowerBudget: number | null;
  borrowerTargetCondition: string;
  estimatedARV: number | null;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface RenovationStrategy {
  arv: number | null;
  asIsValue: number | null;
  rehab: number | null;
  perSqft: number | null;
  basis: number | null;
  netLift: number | null;
  grossReturn: string;
  rehabTime: number | null;
  estimatedTTS: number | null;
  cushion: number | null;
  totalTime: number | null;
  annualizedReturn: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface RenovationStrategies {
  min: RenovationStrategy;
  partial: RenovationStrategy;
  full: RenovationStrategy;
  best: RenovationStrategy;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface MarketDemand {
  score: number | null;
  label: string;
  location: string;
  inventory: string;
  medianTTS: string;
  percentRemodeled: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface ValuationPage {
  valuationResults: ValuationResults;
  renovationStrategies: RenovationStrategies;
  marketDemand: MarketDemand;
}

// ── Comparables (Pages 6, 11, 15-17) ────────────────────────────────────────

export interface Comparable {
  number: number;
  address: string;
  conditionGroup: string; // e.g. "Full Remodel", "Partial Remodel", "Maintained"
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  stories: number | null;
  lot: number | null;
  distance: number | null;
  flags: number | null;
  garage: number | null;
  closeOfEscrow: string;
  salePrice: number | null;
  pricePerSqft: number | null;
  condition: number | null;
  timeToSale: number | null;
  score: number | null;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface ComparablesSection {
  title: string;
  comparables: Comparable[];
}

// ── Budget Flags (Page 18) ──────────────────────────────────────────────────

export interface BudgetFlagSection {
  level: string;
  items: string[];
  boundingBoxes: Record<string, BoundingBox>;
}

export interface BudgetFlags {
  concerns: BudgetFlagSection[];
  missingLineItems: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Budget Line Items (Page 19) ─────────────────────────────────────────────

export interface BudgetLineItem {
  number: number;
  name: string;
  description: string;
  hr: number | null;
  dm: number | null;
  up: number | null;
  rc: number | null;
  soft: number | null;
  total: number | null;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface BudgetCategory {
  name: string;
  hr: number | null;
  dm: number | null;
  up: number | null;
  rc: number | null;
  soft: number | null;
  total: number | null;
  items: BudgetLineItem[];
  boundingBoxes: Record<string, BoundingBox>;
}

export interface BudgetLineItems {
  categories: BudgetCategory[];
  totalHR: number | null;
  totalDM: number | null;
  totalUP: number | null;
  totalRC: number | null;
  totalSoft: number | null;
  grandTotal: number | null;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Full Report ──────────────────────────────────────────────────────────────

export interface RicherValuesReport {
  coverPage: CoverPage;
  valuationSummary: ValuationSummaryAndParameters;
  valuationPage: ValuationPage;
  closestComparables: ComparablesSection;
  additionalComparables: ComparablesSection;
  excludedComparables: ComparablesSection;
  budgetFlags: BudgetFlags;
  budgetLineItems: BudgetLineItems;
}
