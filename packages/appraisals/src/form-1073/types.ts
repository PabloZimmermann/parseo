import type { BoundingBox } from "@parseo/shared";

export type { BoundingBox } from "@parseo/shared";

// ── Subject (Page 1 top) ────────────────────────────────────────────────

export interface SubjectSection {
  propertyAddress: string;
  unitNumber: string;
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
  projectName: string;
  phase: string;
  mapReference: string;
  censusTract: string;
  occupant: string;
  specialAssessments: number | null;
  hoaAmount: number | null;
  hoaPeriod: string;
  propertyRightsAppraised: string;
  assignmentType: string;
  lenderClient: string;
  lenderAddress: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Contract (Page 1) ───────────────────────────────────────────────────

export interface ContractSection {
  isOfferedForSale: string;
  reportDataSources: string;
  contractAnalysis: string;
  contractPrice: number | null;
  dateOfContract: string;
  financialAssistance: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Neighborhood (Page 1) ───────────────────────────────────────────────

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

// ── Project Site (Page 1) ───────────────────────────────────────────────

export interface ProjectSiteSection {
  topography: string;
  size: string;
  density: string;
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

// ── Project Information (Pages 1-2) ─────────────────────────────────────

export interface ProjectInfoSection {
  dataSourcesForProjectInfo: string;
  projectDescription: string;
  numberOfStories: number | null;
  exteriorWalls: string;
  numberOfElevators: number | null;
  roofSurface: string;
  existingOrProposed: string;
  totalParking: number | null;
  parkingRatio: string;
  yearBuilt: number | null;
  parkingType: string;
  effectiveAge: number | null;
  guestParking: number | null;
  numberOfUnits: number | null;
  numberOfPhases: number | null;
  unitsForSale: number | null;
  unitsSold: number | null;
  unitsRented: number | null;
  ownerOccupiedUnits: number | null;
  projectPrimaryOccupancy: string;
  hoaControl: string;
  managementGroup: string;
  singleEntityOwnership: string;
  conversionFromExisting: string;
  unitsComplete: string;
  commercialSpace: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Project Analysis (Page 2) ───────────────────────────────────────────

export interface ProjectAnalysisSection {
  conditionAndQuality: string;
  commonElements: string;
  commonElementsLeased: string;
  groundRent: string;
  parkingAdequacy: string;
  budgetAnalysis: string;
  otherFees: string;
  unitChargeComparison: string;
  specialCharacteristics: string;
  unitChargeMonthly: number | null;
  unitChargeAnnual: number | null;
  assessmentPerSqft: number | null;
  utilitiesIncluded: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Unit Description (Page 2) ───────────────────────────────────────────

export interface UnitDescriptionSection {
  floorNumber: string;
  numberOfLevels: number | null;
  heatingType: string;
  heatingFuel: string;
  centralAC: string;
  floors: string;
  walls: string;
  trimFinish: string;
  bathWainscot: string;
  doors: string;
  fireplaces: number | null;
  deckPatio: string;
  porchBalcony: string;
  refrigerator: string;
  rangeOven: string;
  disposal: string;
  dishwasher: string;
  microwave: string;
  washerDryer: string;
  carStorageType: string;
  carStorageCount: number | null;
  carStorageOwnership: string;
  roomCount: number | null;
  bedrooms: number | null;
  baths: number | null;
  grossLivingArea: number | null;
  separatelyMetered: string;
  additionalFeatures: string;
  conditionDescription: string;
  physicalDeficiencies: string;
  conformity: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Prior Sale History (Page 2 bottom) ──────────────────────────────────

export interface PriorSaleEntry {
  dateOfPriorSale: string;
  priceOfPriorSale: number | null;
  dataSources: string;
  effectiveDateOfDataSources: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface PriorSaleHistorySection {
  researchPerformed: string;
  subjectPriorSaleRevealed: string;
  subjectDataSources: string;
  comparablePriorSaleRevealed: string;
  comparableDataSources: string;
  subject: PriorSaleEntry;
  comparables: PriorSaleEntry[];
  analysis: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Comparable Sale (Pages 3, 7, 8) ─────────────────────────────────────

export interface ComparableSale {
  number: number;
  address: string;
  projectNamePhase: string;
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
  hoaMoAssessment: number | null;
  commonElements: string;
  floorLocation: string;
  view: string;
  designStyle: string;
  qualityOfConstruction: string;
  actualAge: number | null;
  condition: string;
  conditionAdjustment: number | null;
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
  porchPatioDeck: string;
  netAdjustmentTotal: number | null;
  netAdjustmentPercent: number | null;
  grossAdjustmentPercent: number | null;
  adjustedSalePrice: number | null;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Sales Comparison (Page 3) ───────────────────────────────────────────

export interface SalesComparisonSubject {
  address: string;
  projectNamePhase: string;
  salePrice: number | null;
  salePricePerSqft: number | null;
  location: string;
  leaseholdFeeSimple: string;
  hoaMoAssessment: number | null;
  commonElements: string;
  floorLocation: string;
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
  boundingBoxes: Record<string, BoundingBox>;
}

export interface SalesComparisonSection {
  activeListingsCount: number | null;
  activeListingsLow: number | null;
  activeListingsHigh: number | null;
  comparableSalesCount: number | null;
  comparableSalesLow: number | null;
  comparableSalesHigh: number | null;
  subject: SalesComparisonSubject;
  comparables: ComparableSale[];
  summaryOfSalesComparison: string;
  indicatedValueBySalesComparison: number | null;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Reconciliation (Page 3 bottom) ──────────────────────────────────────

export interface ReconciliationSection {
  indicatedValueBySalesComparison: number | null;
  indicatedValueByIncomeApproach: number | null;
  reconciliationComments: string;
  appraisalBasis: string;
  finalValue: number | null;
  effectiveDate: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Appraiser Info (Page 6) ─────────────────────────────────────────────

export interface AppraiserInfo {
  name: string;
  companyName: string;
  companyAddress: string;
  telephoneNumber: string;
  emailAddress: string;
  dateOfSignature: string;
  effectiveDateOfAppraisal: string;
  stateCertification: string;
  stateOrLicense: string;
  state: string;
  expirationDate: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface LenderClientInfo {
  name: string;
  companyName: string;
  companyAddress: string;
  emailAddress: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Full Report ─────────────────────────────────────────────────────────

export interface Form1073Report {
  subject: SubjectSection;
  contract: ContractSection;
  neighborhood: NeighborhoodSection;
  projectSite: ProjectSiteSection;
  projectInfo: ProjectInfoSection;
  projectAnalysis: ProjectAnalysisSection;
  unitDescription: UnitDescriptionSection;
  priorSaleHistory: PriorSaleHistorySection;
  salesComparison: SalesComparisonSection;
  reconciliation: ReconciliationSection;
  appraiser: AppraiserInfo;
  supervisoryAppraiser: AppraiserInfo | null;
  lenderClient: LenderClientInfo;
}
