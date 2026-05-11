import type { BoundingBox } from "@parseo/shared";

export type { BoundingBox } from "@parseo/shared";

// ── Trend (checkbox-based, may not be extractable from all PDFs) ──────────

export type Trend = "Increasing" | "Stable" | "Declining" | null;

// ── Time-period grid row (1004MC) ────────────────────────────────────────

export interface TimePeriodRow {
  prior7to12Months: number | null;
  prior4to6Months: number | null;
  current3Months: number | null;
  overallTrend: Trend;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Subject (Page 1 top) ─────────────────────────────────────────────────

export interface SubjectSection {
  propertyAddress: string;
  city: string;
  state: string;
  zipCode: string;
  borrower: string;
  ownerOfPublicRecord: string;
  county: string;
  legalDescription: string;
  assessorParcelNumber: string;
  taxYear: number | null;
  realEstateTaxes: number | null;
  neighborhoodName: string;
  mapReference: string;
  censusTract: string;
  occupant: string;
  specialAssessments: number | null;
  hoaAmount: number | null;
  propertyRightsAppraised: string;
  assignmentType: string;
  lenderClient: string;
  lenderAddress: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Contract (Page 1) ────────────────────────────────────────────────────

export interface ContractSection {
  isOfferedForSale: string;
  reportDataSources: string;
  contractAnalysis: string;
  contractPrice: number | null;
  dateOfContract: string;
  financialAssistanceAmount: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Neighborhood (Page 1) ────────────────────────────────────────────────

export interface NeighborhoodSection {
  location: string;
  builtUp: string;
  growth: string;
  propertyValues: string;
  demandSupply: string;
  marketingTime: string;
  priceLow: number | null;
  priceHigh: number | null;
  pricePredominant: number | null;
  ageLow: number | null;
  ageHigh: number | null;
  agePredominant: number | null;
  landUseOneUnit: number | null;
  landUseTwoFourUnit: number | null;
  landUseMultiFamily: number | null;
  landUseCommercial: number | null;
  landUseOther: number | null;
  boundaries: string;
  description: string;
  marketConditions: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Site (Page 1) ────────────────────────────────────────────────────────

export interface SiteSection {
  dimensions: string;
  area: string;
  shape: string;
  view: string;
  zoningClassification: string;
  zoningDescription: string;
  zoningCompliance: string;
  highestAndBestUse: string;
  femaFloodZone: string;
  femaMapNumber: string;
  femaMapDate: string;
  adverseConditions: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Improvements (Page 1) ────────────────────────────────────────────────

export interface ImprovementsSection {
  stories: number | null;
  type: string;
  designStyle: string;
  yearBuilt: number | null;
  effectiveAge: number | null;
  foundationWalls: string;
  exteriorWalls: string;
  roofSurface: string;
  guttersDownspouts: string;
  windowType: string;
  floors: string;
  walls: string;
  trimFinish: string;
  bathFloor: string;
  bathWainscot: string;
  heatingType: string;
  heatingFuel: string;
  coolingType: string;
  fireplaces: number | null;
  patioOrDeck: string;
  pool: string;
  fence: string;
  porch: string;
  drivewayCarCount: number | null;
  drivewaySurface: string;
  garageCarCount: number | null;
  carportCarCount: number | null;
  roomCount: number | null;
  bedrooms: number | null;
  baths: number | null;
  grossLivingArea: number | null;
  additionalFeatures: string;
  conditionDescription: string;
  physicalDeficiencies: string;
  conformity: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Comparable Sale (Pages 2, 7) ─────────────────────────────────────────

export interface ComparableSale {
  number: number;
  address: string;
  proximityToSubject: string;
  salePrice: number | null;
  salePricePerSqft: number | null;
  dataSources: string;
  verificationSources: string;
  salesOrFinancing: string;
  concessions: string;
  dateOfSaleTime: string;
  location: string;
  leaseholdFeeSimple: string;
  site: string;
  siteAdjustment: number | null;
  view: string;
  viewAdjustment: number | null;
  designStyle: string;
  qualityOfConstruction: string;
  actualAge: number | null;
  ageAdjustment: number | null;
  condition: string;
  roomCountTotal: number | null;
  roomCountBedrooms: number | null;
  roomCountBaths: number | null;
  roomCountAdjustment: number | null;
  grossLivingArea: number | null;
  grossLivingAreaAdjustment: number | null;
  basementFinished: string;
  functionalUtility: string;
  heatingCooling: string;
  energyEfficientItems: string;
  garageCarport: string;
  garageCarportAdjustment: number | null;
  porchPatioDeck: string;
  pool: string;
  poolAdjustment: number | null;
  originalListPrice: string;
  netAdjustmentTotal: number | null;
  netAdjustmentPercent: number | null;
  grossAdjustmentPercent: number | null;
  adjustedSalePrice: number | null;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Sales Comparison (Page 2) ────────────────────────────────────────────

export interface SalesComparisonSection {
  activeListingsLow: number | null;
  activeListingsHigh: number | null;
  comparableSalesLow: number | null;
  comparableSalesHigh: number | null;
  subject: {
    address: string;
    salePrice: number | null;
    salePricePerSqft: number | null;
    location: string;
    leaseholdFeeSimple: string;
    site: string;
    view: string;
    designStyle: string;
    qualityOfConstruction: string;
    actualAge: number | null;
    condition: string;
    roomCountTotal: number | null;
    roomCountBedrooms: number | null;
    roomCountBaths: number | null;
    grossLivingArea: number | null;
    basementFinished: string;
    functionalUtility: string;
    heatingCooling: string;
    energyEfficientItems: string;
    garageCarport: string;
    porchPatioDeck: string;
    pool: string;
    originalListPrice: string;
    boundingBoxes: Record<string, BoundingBox>;
  };
  comparables: ComparableSale[];
  priorSaleAnalysis: string;
  summaryOfSalesComparison: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Reconciliation (Page 2 bottom) ───────────────────────────────────────

export interface ReconciliationSection {
  indicatedValueBySalesComparison: number | null;
  indicatedValueByCostApproach: number | null;
  indicatedValueByIncomeApproach: number | null;
  reconciliationComments: string;
  appraisalBasis: string;
  finalValue: number | null;
  effectiveDate: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Cost Approach (Page 3) ───────────────────────────────────────────────

export interface CostApproachSection {
  siteValueSupport: string;
  siteValue: number | null;
  dwellingSqft: number | null;
  dwellingCostPerSqft: number | null;
  dwellingCost: number | null;
  amenitiesCost: number | null;
  garageCarportSqft: number | null;
  garageCarportCostPerSqft: number | null;
  garageCarportCost: number | null;
  totalCostNew: number | null;
  depreciation: number | null;
  depreciatedCostOfImprovements: number | null;
  asIsValueOfSiteImprovements: number | null;
  indicatedValueByCostApproach: number | null;
  estimatedRemainingEconomicLife: number | null;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── 1004MC Market Conditions Addendum ────────────────────────────────────

export interface Form1004MCHeader {
  propertyAddress: string;
  city: string;
  state: string;
  zipCode: string;
  borrower: string;
  fileNumber: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface InventoryAnalysis {
  totalComparableSales: TimePeriodRow;
  absorptionRate: TimePeriodRow;
  totalActiveListings: TimePeriodRow;
  monthsOfSupply: TimePeriodRow;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface MedianSaleListData {
  medianSalePrice: TimePeriodRow;
  medianSalesDaysOnMarket: TimePeriodRow;
  medianListPrice: TimePeriodRow;
  medianListingsDaysOnMarket: TimePeriodRow;
  medianSalePriceAsPercentOfList: TimePeriodRow;
  sellerPaidFinancialAssistance: boolean | null;
  sellerPaidFinancialAssistanceTrend: Trend;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface MarketAnalysisText {
  sellerConcessionsExplanation: string;
  foreclosureSalesInMarket: boolean | null;
  foreclosureExplanation: string;
  dataSources: string;
  summary: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface CondoCoopProjects {
  projectName: string;
  totalComparableSales: TimePeriodRow;
  absorptionRate: TimePeriodRow;
  totalActiveListings: TimePeriodRow;
  monthsOfUnitSupply: TimePeriodRow;
  foreclosureSalesInProject: boolean | null;
  foreclosureExplanation: string;
  summary: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface AppraiserInfo {
  name: string;
  companyName: string;
  companyAddress: string;
  stateLicenseCertification: string;
  state: string;
  email: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface MarketConditionsAddendum {
  header: Form1004MCHeader;
  inventoryAnalysis: InventoryAnalysis;
  medianSaleListData: MedianSaleListData;
  marketAnalysisText: MarketAnalysisText;
  condoCoopProjects: CondoCoopProjects | null;
  appraiser: AppraiserInfo;
  supervisoryAppraiser: AppraiserInfo | null;
}

// ── Full Report ───────────────────────────────────────────────────────────

export interface Form1004MCReport {
  subject: SubjectSection;
  contract: ContractSection;
  neighborhood: NeighborhoodSection;
  site: SiteSection;
  improvements: ImprovementsSection;
  salesComparison: SalesComparisonSection;
  reconciliation: ReconciliationSection;
  costApproach: CostApproachSection;
  marketConditionsAddendum: MarketConditionsAddendum;
}
