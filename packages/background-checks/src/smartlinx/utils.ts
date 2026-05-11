import type { TextLine } from "@parseo/shared";
import type { Section } from "@parseo/shared";

export type { Section } from "@parseo/shared";

// ── Section splitting ─────────────────────────────────────────────────────────

export const SECTION_HEADERS = [
  "Person Summary",
  "Summary",
  "At a Glance",
  "Name Variations, SSN Summary and DOBs",
  "Physical Description",
  "Phones",
  "Address Summary",
  "Licenses/Voter",
  "Driver Licenses",
  "Other Licenses",
  "Real Property",
  "Personal Property",
  "Possible Education",
  "Possible Criminal/Arrest",
  "Bankruptcy",
  "Judgment / Liens",
  "UCC Filings",
  "Associates",
  "Possible Relatives",
  "Person Associates",
  "Neighbors",
  "Business Connections",
  "Possible Employers",
  "Business Associates",
  "Sources",
] as const;

export type SectionName = (typeof SECTION_HEADERS)[number];

export function isSectionHeader(line: TextLine): string | null {
  const text = line.fullText.trim();

  // Skip lines that are clearly table content (contain numbers and multiple columns)
  // This prevents "Associates" within the At a Glance table from being detected as a header
  if (text.match(/\d+\s{2,}/) && line.segments.length > 2) return null;

  // Only match headers that appear as the primary/sole content of a line
  // (section headers in SmartLinx are on their own line, not embedded in tables)
  for (const header of SECTION_HEADERS) {
    if (
      text === header ||
      text.startsWith(header + " (") ||
      text.startsWith(header + " -") ||
      text.startsWith(header + "(")
    ) {
      // "Associates" alone is ambiguous - only match if it's exactly "Associates"
      // and has meaningful content after it (not just a number)
      if (header === "Associates" && line.segments.length > 1) {
        // This is likely inside the At a Glance table
        return null;
      }
      return header;
    }
  }
  return null;
}

export function splitIntoSections(lines: TextLine[]): Section[] {
  const sections: Section[] = [];
  let currentSection: Section | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerName = isSectionHeader(line);

    if (headerName) {
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = { name: headerName, lines: [], startIndex: i };
    } else if (currentSection) {
      currentSection.lines.push(line);
    }
  }
  if (currentSection) {
    sections.push(currentSection);
  }

  return sections;
}
