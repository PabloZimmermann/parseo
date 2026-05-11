import type { TextLine } from "@parseo/shared";
import type { Section } from "@parseo/shared";

export type { Section } from "@parseo/shared";

// ── Section splitting ─────────────────────────────────────────────────────────

export const SECTION_HEADERS = [
  "Credit Score Information",
  "Fraud Messages",
  "Credit Summary",
  "File Variation Warning",
  "Credit History",
  "Inquiries (Last 120 Days)",
  "Inquiries (continued)",
  "Public Records",
  "Repository Files Returned",
  "Repository/Fraud Messages",
  "Creditors",
  "Disclaimer",
  "Credit Repositories",
] as const;

export type SectionName = (typeof SECTION_HEADERS)[number];

export function isSectionHeader(line: TextLine): string | null {
  const text = line.fullText.trim();
  for (const header of SECTION_HEADERS) {
    if (text === header) return header;
  }
  return null;
}

/**
 * Split lines into named sections. Lines before the first section header
 * go into a special "Header" section.
 */
export function splitIntoSections(lines: TextLine[]): Section[] {
  const sections: Section[] = [];
  let currentSection: Section = { name: "Header", lines: [], startIndex: 0 };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerName = isSectionHeader(line);

    if (headerName) {
      if (currentSection.lines.length > 0 || currentSection.name !== "Header") {
        sections.push(currentSection);
      }
      currentSection = { name: headerName, lines: [], startIndex: i };
    } else {
      currentSection.lines.push(line);
    }
  }
  if (currentSection.lines.length > 0) {
    sections.push(currentSection);
  }

  return sections;
}

export function getSections(sections: Section[], name: string): Section[] {
  return sections.filter((s) => s.name === name);
}

// ── Xactus-specific line utilities ──────────────────────────────────────────

export function findLabelValue(line: TextLine, label: string): string {
  for (let i = 0; i < line.segments.length; i++) {
    const seg = line.segments[i];
    if (seg.text.trim().startsWith(label)) {
      const after = seg.text.trim().slice(label.length).trim();
      if (after) return after;
      if (i + 1 < line.segments.length) return line.segments[i + 1].text.trim();
    }
  }
  return "";
}

export function findLabelValueInText(text: string, label: string): string {
  const idx = text.indexOf(label);
  if (idx < 0) return "";
  const after = text.slice(idx + label.length).trim();
  // Take until double-space or end
  const m = after.match(/^(.+?)(?:\s{2,}|$)/);
  return m ? m[1].trim() : after.trim();
}
