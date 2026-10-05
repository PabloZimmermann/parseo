import type { BoundingBox } from "@parseo/shared";

export type { BoundingBox } from "@parseo/shared";

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
  hoaPeriod: string;
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
  sellerIsOwnerOfRecord: string;
  financialAssistance: string;
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
  femaSpecialFloodHazardArea: string;
  femaFloodZone: string;
  femaMapNumber: string;
  femaMapDate: string;
  adverseConditions: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Improvements (Pages 1-2) ─────────────────────────────────────────────

export interface ImprovementUnit {
  unit: number;
  rooms: number | null;
  bedrooms: number | null;
  baths: number | null;
  grossLivingArea: number | null;
}

export interface ImprovementsSection {
  units: string;
  numberOfStories: number | null;
  numberOfBuildings: number | null;
  foundation: string;
  type: string;
  existingProposed: string;
  designStyle: string;
  yearBuilt: number | null;
  effectiveAge: number | null;
  foundationWalls: string;
  exteriorWalls: string;
  roofSurface: string;
  guttersDownspouts: string;
  windowType: string;
  stormSashInsulated: string;
  screens: string;
  floors: string;
  walls: string;
  trimFinish: string;
  bathFloor: string;
  bathWainscot: string;
  heatingType: string;
  heatingFuel: string;
  cooling: string;
  fireplaces: number | null;
  woodstoves: number | null;
  patioDeck: string;
  pool: string;
  fence: string;
  porch: string;
  drivewayCarCount: number | null;
  drivewaySurface: string;
  garageCarCount: number | null;
  carportCarCount: number | null;
  refrigerator: number | null;
  rangeOven: number | null;
  dishwasher: number | null;
  disposal: number | null;
  microwave: number | null;
  washerDryer: number | null;
  unitBreakdown: ImprovementUnit[];
  additionalFeatures: string;
  conditionDescription: string;
  physicalDeficiencies: string;
  conformity: string;
  rentControl: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Comparable Rental Data (Page 2) ──────────────────────────────────────

export interface RentalUnit {
  roomCountTotal: number | null;
  bedrooms: number | null;
  baths: number | null;
  sizeSqft: number | null;
  monthlyRent: number | null;
}

export interface RentalComparable {
  /** 0 = subject, 1-3 = comparable rentals */
  number: number;
  address: string;
  proximityToSubject: string;
  currentMonthlyRent: number | null;
  rentPerSqft: number | null;
  rentControl: string;
  dataSources: string;
  dateOfLease: string;
  location: string;
  actualAge: number | null;
  condition: string;
  grossBuildingArea: number | null;
  units: RentalUnit[];
  utilitiesIncluded: string;
  xtraAmenities: string;
  type: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface ComparableRentalDataSection {
  subject: RentalComparable;
  comparables: RentalComparable[];
  analysis: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Subject Rent Schedule (Page 2) ───────────────────────────────────────

export interface RentScheduleUnit {
  unit: number;
  leaseBeginDate: string;
  leaseEndDate: string;
  actualRentUnfurnished: number | null;
  actualRentFurnished: number | null;
  actualTotalRent: number | null;
  marketRentUnfurnished: number | null;
  marketRentFurnished: number | null;
  marketTotalRent: number | null;
}

export interface SubjectRentScheduleSection {
  units: RentScheduleUnit[];
  commentOnLeaseData: string;
  totalActualMonthlyRent: number | null;
  totalGrossMonthlyRent: number | null;
  totalActualMonthlyIncome: number | null;
  totalEstimatedMonthlyIncome: number | null;
  comments: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Prior Sale History (Page 2 bottom) ───────────────────────────────────

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

// ── Sales Comparison (Page 3) ────────────────────────────────────────────

export interface ComparableSale {
  number: number;
  address: string;
  proximityToSubject: string;
  salePrice: number | null;
  salePricePerGBA: number | null;
  grossMonthlyRent: number | null;
  grossRentMultiplier: number | null;
  pricePerUnit: number | null;
  pricePerRoom: number | null;
  pricePerBedroom: number | null;
  rentControl: string;
  dataSources: string;
  verificationSources: string;
  saleOrFinancing: string;
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
  condition: string;
  grossBuildingArea: number | null;
  grossBuildingAreaAdjustment: number | null;
  functionalUtility: string;
  heatingCooling: string;
  energyEfficientItems: string;
  parkingOnOffSite: string;
  porchPatioDeck: string;
  appliancesFireplaces: string;
  netAdjustmentTotal: number | null;
  netAdjustmentPercent: number | null;
  grossAdjustmentPercent: number | null;
  adjustedSalePrice: number | null;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface SalesComparisonSubject {
  address: string;
  salePrice: number | null;
  salePricePerGBA: number | null;
  grossMonthlyRent: number | null;
  location: string;
  leaseholdFeeSimple: string;
  site: string;
  view: string;
  designStyle: string;
  qualityOfConstruction: string;
  actualAge: number | null;
  condition: string;
  grossBuildingArea: number | null;
  functionalUtility: string;
  heatingCooling: string;
  energyEfficientItems: string;
  parkingOnOffSite: string;
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

// ── Income Approach (Page 3) ─────────────────────────────────────────────

export interface IncomeSection {
  totalGrossMonthlyRent: number | null;
  grossRentMultiplier: number | null;
  indicatedValueByIncomeApproach: number | null;
  comments: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Reconciliation (Page 3 bottom) ───────────────────────────────────────

export interface ReconciliationSection {
  indicatedValueBySalesComparison: number | null;
  indicatedValueByIncomeApproach: number | null;
  indicatedValueByCostApproach: number | null;
  reconciliationComments: string;
  appraisalBasis: string;
  /**
   * Which basis checkbox is marked. Combine with finalValue to know the value
   * type: "as is" → as-is value; "subject to completion"/"subject to repairs"
   * → as-completed value; "subject to inspection". "" when undetected.
   */
  appraisalBasisType: "as is" | "subject to completion" | "subject to repairs" | "subject to inspection" | "";
  finalValue: number | null;
  effectiveDate: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Cost Approach (Page 4) ───────────────────────────────────────────────

export interface CostApproachSection {
  costBasisType: "Reproduction" | "Replacement" | "";
  supportForOpinionOfSiteValue: string;
  opinionOfSiteValue: number | null;
  sourceOfCostData: string;
  qualityRating: string;
  effectiveDateOfCostData: string;
  dwellingSqft: number | null;
  dwellingCostPerSqft: number | null;
  dwellingCost: number | null;
  garageCarportSqft: number | null;
  garageCarportCost: number | null;
  totalEstimateOfCostNew: number | null;
  depreciation: number | null;
  depreciatedCostOfImprovements: number | null;
  asIsValueOfSiteImprovements: number | null;
  indicatedValueByCostApproach: number | null;
  estimatedRemainingEconomicLife: number | null;
  comments: string;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Appraiser Info (Page 7) ──────────────────────────────────────────────

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
  addressOfPropertyAppraised: string;
  appraisedValueOfSubjectProperty: number | null;
  boundingBoxes: Record<string, BoundingBox>;
}

// ── Full Report ──────────────────────────────────────────────────────────

export interface Form1025Report {
  appraisalType: "1025";
  subject: SubjectSection;
  contract: ContractSection;
  neighborhood: NeighborhoodSection;
  site: SiteSection;
  improvements: ImprovementsSection;
  comparableRentalData: ComparableRentalDataSection;
  subjectRentSchedule: SubjectRentScheduleSection;
  priorSaleHistory: PriorSaleHistorySection;
  salesComparison: SalesComparisonSection;
  income: IncomeSection;
  reconciliation: ReconciliationSection;
  costApproach: CostApproachSection;
  additionalComments: string;
  appraiser: AppraiserInfo;
  supervisoryAppraiser: AppraiserInfo | null;
  lenderClient: LenderClientInfo;
}
