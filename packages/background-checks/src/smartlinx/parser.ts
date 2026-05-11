import { extractLines } from "@parseo/shared";
import { UnrecognizedFormatError, MissingSectionError } from "@parseo/shared";
import { getSection } from "@parseo/shared";
import { splitIntoSections } from "./utils.js";
import type { TextLine } from "@parseo/shared";
import type { SmartLinxReport } from "./types.js";

import {
  parseReportMetadata,
  parsePersonSummary,
  parseAtAGlance,
  parseNameVariations,
  parsePhysicalDescription,
  parsePhones,
} from "./sections/person-summary.js";
import { parseAddresses } from "./sections/addresses.js";
import { parseDriverLicenses, parseOtherLicenses } from "./sections/licenses.js";
import { parseRealProperty, parsePersonalProperty } from "./sections/property.js";
import {
  parseEducation,
  parseCriminalArrest,
  parseBankruptcy,
  parseJudgmentsLiens,
  parseUCCFilings,
} from "./sections/records.js";
import {
  parseRelatives,
  parsePersonAssociates,
  parseNeighbors,
  parseBusinessConnections,
  parseEmployers,
  parseBusinessAssociates,
} from "./sections/associates.js";

export async function parseSmartLinxReport(buffer: Buffer): Promise<SmartLinxReport> {
  const lines = await extractLines(buffer);
  return parseSmartLinxReportFromLines(lines);
}

export function parseSmartLinxReportFromLines(lines: TextLine[]): SmartLinxReport {
  // Format fingerprint check
  const head = lines.slice(0, 20).map((l) => l.fullText).join("\n");
  if (!/SmartLinx|Person Report|LexisNexis/i.test(head)) {
    throw new UnrecognizedFormatError(
      "SmartLinx",
      "first 20 lines do not contain a SmartLinx / Person Report / LexisNexis signature"
    );
  }

  const sections = splitIntoSections(lines);

  const emptySection = { name: "", lines: [] as TextLine[], startIndex: 0 };

  const personSummary = parsePersonSummary(
    getSection(sections, "Summary") ?? getSection(sections, "Person Summary") ?? emptySection
  );

  if (!personSummary.name) {
    throw new MissingSectionError("SmartLinx", "personSummary.name");
  }

  return {
    reportMetadata: parseReportMetadata(lines),
    personSummary,
    atAGlance: parseAtAGlance(
      getSection(sections, "At a Glance") ?? emptySection
    ),
    nameVariations: parseNameVariations(
      getSection(sections, "Name Variations, SSN Summary and DOBs") ?? emptySection
    ),
    physicalDescription: parsePhysicalDescription(
      getSection(sections, "Physical Description") ?? emptySection
    ),
    phones: parsePhones(
      getSection(sections, "Phones") ?? emptySection
    ),
    addresses: parseAddresses(
      getSection(sections, "Address Summary") ?? emptySection
    ),
    driverLicenses: parseDriverLicenses(
      getSection(sections, "Driver Licenses") ?? emptySection
    ),
    otherLicenses: parseOtherLicenses(
      getSection(sections, "Other Licenses") ?? emptySection
    ),
    realProperty: parseRealProperty(
      getSection(sections, "Real Property") ?? emptySection
    ),
    personalProperty: parsePersonalProperty(
      getSection(sections, "Personal Property") ?? emptySection
    ),
    education: parseEducation(
      getSection(sections, "Possible Education") ?? emptySection
    ),
    criminalArrest: parseCriminalArrest(
      getSection(sections, "Possible Criminal/Arrest") ?? emptySection
    ),
    bankruptcy: parseBankruptcy(
      getSection(sections, "Bankruptcy") ?? emptySection
    ),
    judgmentsLiens: parseJudgmentsLiens(
      getSection(sections, "Judgment / Liens") ?? emptySection
    ),
    uccFilings: parseUCCFilings(
      getSection(sections, "UCC Filings") ?? emptySection
    ),
    possibleRelatives: parseRelatives(
      getSection(sections, "Possible Relatives") ?? emptySection
    ),
    personAssociates: parsePersonAssociates(
      getSection(sections, "Person Associates") ?? emptySection
    ),
    neighbors: parseNeighbors(
      getSection(sections, "Neighbors") ?? emptySection
    ),
    businessConnections: parseBusinessConnections(
      getSection(sections, "Business Connections") ?? emptySection
    ),
    possibleEmployers: parseEmployers(
      getSection(sections, "Possible Employers") ?? emptySection
    ),
    businessAssociates: parseBusinessAssociates(
      getSection(sections, "Business Associates") ?? emptySection
    ),
  };
}

/** Debug utility: extract lines and sections for inspection */
export async function debugExtract(buffer: Buffer) {
  const lines = await extractLines(buffer);
  const sections = splitIntoSections(lines);
  return { lines, sections };
}
