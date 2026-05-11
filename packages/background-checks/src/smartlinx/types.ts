import type { DateString, DateRange, BoundingBox } from "@parseo/shared";

export type { DateString, DateRange, BoundingBox } from "@parseo/shared";

/** Reusable address block */
export interface Address {
  street: string;
  city: string;
  state: string;
  zip: string;
  county: string;
}

/** Reusable entity with name + address */
export interface NamedEntity {
  name: string;
  address: string;
}

/** Reusable person identity block (relatives, associates, neighbors) */
export interface PersonIdentity {
  name: string;
  lexId: string;
  ssn: string;
  dob: DateString;
  age: number | null;
  address: string;
  phone: string;
  deceased: boolean;
}

// ── Report output types ───────────────────────────────────────────────────────

export interface SmartLinxReport {
  reportMetadata: ReportMetadata;
  personSummary: PersonSummary;
  atAGlance: AtAGlance;
  nameVariations: NameVariations;
  physicalDescription: PhysicalDescription;
  phones: PhoneRecord[];
  addresses: AddressRecord[];
  driverLicenses: DriverLicense[];
  otherLicenses: OtherLicense[];
  realProperty: RealPropertyRecord[];
  personalProperty: PersonalPropertyRecord[];
  education: EducationRecord[];
  criminalArrest: CriminalRecord[];
  bankruptcy: BankruptcyRecord[];
  judgmentsLiens: JudgmentLienRecord[];
  uccFilings: UCCFilingRecord[];
  possibleRelatives: RelativeRecord[];
  personAssociates: PersonAssociateRecord[];
  neighbors: NeighborGroup[];
  businessConnections: BusinessConnectionRecord[];
  possibleEmployers: EmployerRecord[];
  businessAssociates: BusinessAssociateRecord[];
}

export interface ReportMetadata {
  generatedOn: DateString;
  searchTerms: string;
  reportCreatedFor: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface PersonSummary {
  name: string;
  location: string;
  age: number | null;
  lexId: string;
  ssn: string;
  gender: string;
  dob: DateString;
  currentAddress: string;
  addressDateRange: DateRange;
  county: string;
  phones: { number: string; dateRange: DateRange }[];
  emails: string[];
  boundingBoxes: Record<string, BoundingBox>;
}

export interface AtAGlance {
  possibleRelatives: number;
  businessConnections: number;
  criminalArrest: number;
  bankruptcy: number;
  realProperty: number;
  professionalLicenses: number;
  personAssociates: number;
  possibleEmployers: number;
  businessAssociates: number;
  judgmentsLiens: number;
  personalProperty: number;
  foreclosureNoticeOfDefault: number;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface NameVariations {
  names: string[];
  ssnSummary: { ssn: string; issuedState: string; issuedYearRange: string }[];
  reportedDobs: DateString[];
  boundingBoxes: Record<string, BoundingBox>;
}

export interface PhysicalDescription {
  hairColor: string;
  eyeColor: string;
  height: string;
  weight: string;
  scarsMarks: string;
  dateLastSeen: DateString;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface PhoneRecord {
  number: string;
  dateRange: DateRange;
  lineType: string;
  listingName: string;
  carrier: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface VerifyingSource {
  source: string;
  count: number;
}

export interface AddressRecord extends Address {
  number: number;
  type: string;
  status: string;
  dateRange: DateRange;
  phone: string;
  householdMembers: string[];
  namesAssociatedWithAddress: string[];
  neighborhoodProfile: NeighborhoodProfile | null;
  verifyingSourcesByType: VerifyingSource[];
  boundingBoxes: Record<string, BoundingBox>;
}

export interface NeighborhoodProfile {
  averageAge: number | null;
  medianHouseholdIncome: number | null;
  medianHomeValue: number | null;
  averageYearsOfEducation: number | null;
}

export interface DriverLicense {
  name: string;
  address: string;
  status: string;
  issuedDate: DateString;
  expiresDate: DateString;
  location: string;
  ssn: string;
  dob: DateString;
  gender: string;
  height: string;
  dataSource: string;
  licenseType: string;
  licenseClass: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface OtherLicense {
  number: number;
  type: string;
  status: string;
  issuedDate: DateString;
  expiresDate: DateString;
  location: string;
  name: string;
  address: string;
  // Voter-specific
  lastVoted: DateString;
  party: string;
  // Professional-specific
  licenseNumber: string;
  licenseType: string;
  // Sports-specific
  homeState: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface MortgageInfo {
  loanAmount: number | null;
  description: string;
  lenderName: string;
  loanType: string;
  recordingDate: DateString;
  contractDate: DateString;
  transactionType: string;
}

export interface LegalInfo {
  parcelNumber: string;
  assessmentYear: number | null;
  salePrice: number | null;
  saleDate: DateString;
  recordingDate: DateString;
  documentType: string;
  assessedValue: number | null;
  marketLandValue: number | null;
  totalMarketValue: number | null;
  typeOfAddress: string;
  mortgageLenderName: string;
}

export interface RealPropertyRecord extends Address {
  number: number;
  source: string;
  status: string;
  purchasePrice: number | null;
  salePrice: number | null;
  owners: string[];
  mortgages: MortgageInfo[];
  legalInfo: Partial<LegalInfo>;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface VehicleRegistrant {
  name: string;
  address: string;
  plateNumber: string;
  licensePlateState: string;
  licensePlateType: string;
  originalRegistrationDate: DateString;
  latestRegistrationDate: DateString;
  expirationDate: DateString;
}

export interface VehicleOwner {
  name: string;
  address: string;
  titleNumber: string;
  titleDate: DateString;
}

export interface LienHolder extends NamedEntity {}

export interface PersonalPropertyRecord {
  number: number;
  type: string;
  status: string;
  year: number | null;
  make: string;
  model: string;
  vin: string;
  classType: string;
  basePrice: number | null;
  registrants: VehicleRegistrant[];
  owners: VehicleOwner[];
  lienHolders: LienHolder[];
  watercraftInfo: WatercraftInfo | null;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface WatercraftInfo {
  vesselServiceType: string;
  length: string;
  propulsion: string;
  registrationNumber: string;
  registrationStatus: string;
  registrationDate: DateString;
  expirationDate: DateString;
}

export interface EducationRecord {
  school: string;
  dateRange: DateRange;
  level: string;
  address: string;
  graduationYear: number | null;
  yearsSinceGraduation: number | null;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface CriminalRecord {
  number: number;
  name: string;
  type: string;
  offense: string;
  date: DateString;
  state: string;
  dataSource: string;
  address: string;
  offenses: { description: string; date: DateString }[];
  boundingBoxes: Record<string, BoundingBox>;
}

export interface BankruptcyRecord {
  number: number;
  type: string;
  status: string;
  filingDate: DateString;
  caseNumber: string;
  chapter: string;
  jurisdiction: string;
  petitioners: (NamedEntity & { type: string })[];
  attorneys: NamedEntity[];
  trustees: NamedEntity[];
  filingStatus: string;
  filingType: string;
  comment: string;
  statusDate: DateString;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface JudgmentLienRecord {
  number: number;
  type: string;
  status: string;
  amount: number | null;
  fileDate: DateString;
  fileNumber: string;
  jurisdiction: string;
  debtors: NamedEntity[];
  creditors: NamedEntity[];
  filingType: string;
  filingAgency: string;
  filingAgencyState: string;
  filingAgencyCounty: string;
  landlordTenantDispute: boolean | null;
  book: string;
  page: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface UCCFilingRecord {
  number: number;
  fileNumber: string;
  fileDate: DateString;
  status: string;
  securingParty: NamedEntity;
  debtor: NamedEntity;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface RelativeRecord extends PersonIdentity {
  number: number;
  relationship: string;
  secondDegreeRelatives: SecondDegreeRelative[];
  boundingBoxes: Record<string, BoundingBox>;
}

export interface SecondDegreeRelative extends Omit<PersonIdentity, "phone"> {}

export interface PersonAssociateRecord extends PersonIdentity {
  number: number;
  role: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface NeighborGroup {
  address: string;
  residents: NeighborResident[];
  boundingBoxes: Record<string, BoundingBox>;
}

export interface NeighborResident extends Omit<PersonIdentity, "address" | "phone"> {}

export interface BusinessConnectionRecord {
  number: number;
  name: string;
  address: string;
  title: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface EmployerRecord {
  number: number;
  name: string;
  address: string;
  phone: string;
  boundingBoxes: Record<string, BoundingBox>;
}

export interface BusinessAssociateRecord {
  number: number;
  name: string;
  address: string;
  role: string;
  boundingBoxes: Record<string, BoundingBox>;
}
