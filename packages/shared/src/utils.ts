import type { TextLine } from "./types.js";
import type { DateString, DateRange } from "./types.js";

export { type DateString, type DateRange } from "./types.js";

// ── Date & currency parsing ───────────────────────────────────────────────────

/**
 * Parse various date formats into ISO 8601 partial date strings.
 * "02/04/2024"  → "2024-02-04"
 * "01/1989"     → "1989-01"
 * "2007"        → "2007"
 * "Current"     → "present"
 * ""            → null
 */
export function parseDate(raw: string): DateString {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s === "--/----" || s === "--/--/----") return null;
  if (s.toLowerCase() === "current" || s.toLowerCase() === "present") return "present";

  // MM/DD/YYYY
  const full = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (full) return `${full[3]}-${full[1]}-${full[2]}`;

  // MM/YYYY
  const monthYear = s.match(/^(\d{2})\/(\d{4})$/);
  if (monthYear) return `${monthYear[2]}-${monthYear[1]}`;

  // YYYY only
  const yearOnly = s.match(/^(\d{4})$/);
  if (yearOnly) return yearOnly[1];

  // Embedded MM/DD/YYYY
  const embedded = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (embedded) return `${embedded[3]}-${embedded[1]}-${embedded[2]}`;

  // Embedded MM/YYYY
  const embeddedMY = s.match(/(\d{2})\/(\d{4})/);
  if (embeddedMY) return `${embeddedMY[2]}-${embeddedMY[1]}`;

  return null;
}

/**
 * Parse a date range string like "02/2010 - 02/2026" or "2021 - Current"
 */
export function parseDateRange(raw: string): DateRange {
  if (!raw) return { from: null, to: null };
  const s = raw.trim();
  const parts = s.split(/\s*-\s*/);
  if (parts.length >= 2) {
    return {
      from: parseDate(parts[0]),
      to: parseDate(parts.slice(1).join("-").trim()),
    };
  }
  return { from: parseDate(s), to: null };
}

/**
 * Parse currency string to cents-safe number.
 * "$1,200,000" → 1200000
 * "$5,250.00"  → 5250
 * ""           → null
 */
export function parseCurrency(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}

/**
 * Parse a numeric string to number or null.
 */
export function parseNum(raw: string): number | null {
  if (!raw) return null;
  const n = parseFloat(raw.replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? null : n;
}

// ── String utilities ─────────────────────────────────────────────────────────

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function cleanNumber(s: string): string {
  return s.replace(/[^0-9.-]/g, "");
}

// ── Section interface ────────────────────────────────────────────────────────

export interface Section {
  name: string;
  lines: TextLine[];
  startIndex: number;
}

export function getSection(sections: Section[], name: string): Section | null {
  let best: Section | null = null;
  for (const s of sections) {
    if (s.name === name) {
      if (!best || s.lines.length > best.lines.length) {
        best = s;
      }
    }
  }
  return best;
}

// ── Line parsing utilities ────────────────────────────────────────────────────

/** Get text from segment at approximate column position */
export function getSegmentNear(line: TextLine, x: number, tolerance = 30): string {
  for (const seg of line.segments) {
    if (Math.abs(seg.x - x) < tolerance) {
      return seg.text.trim();
    }
  }
  return "";
}

/** Extract value after a label like "LexID  0065-8125-1321" */
export function extractLabelValue(
  line: TextLine,
  label: string
): string | null {
  for (const seg of line.segments) {
    const text = seg.text.trim();
    if (text.startsWith(label)) {
      const val = text.slice(label.length).trim();
      if (val) return val;
    }
  }
  // Check across segments: label in one, value in next
  for (let i = 0; i < line.segments.length - 1; i++) {
    if (line.segments[i].text.trim() === label.replace(/:?\s*$/, "").trim()) {
      return line.segments[i + 1].text.trim();
    }
  }
  return null;
}

/** Find a label in the full text and return its value */
export function findLabelInText(text: string, label: string): string {
  const patterns = [
    new RegExp(`${escapeRegex(label)}\\s*[:.]?\\s*(.+?)(?:\\s{2,}|$)`),
    new RegExp(`${escapeRegex(label)}\\s*[:.]?\\s*(.+)`),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return "";
}

/** Check if line starts with a number followed by a period */
export function isNumberedEntry(line: TextLine): number | null {
  const m = line.fullText.trim().match(/^(\d+)\.\s/);
  return m ? parseInt(m[1], 10) : null;
}

/** Check if a line starts with a bullet */
export function isBulletLine(line: TextLine): string | null {
  const text = line.fullText.trim();
  if (text.startsWith("•") || text.startsWith("·") || text.startsWith("- ")) {
    return text.replace(/^[•·\-]\s*/, "").trim();
  }
  return null;
}

/** Parse bullet lines into key-value pairs where format is "Key: Value" */
export function parseBulletKeyValues(
  lines: TextLine[]
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of lines) {
    const bullet = isBulletLine(line);
    if (bullet) {
      const colonIdx = bullet.indexOf(":");
      if (colonIdx > 0) {
        const key = bullet.slice(0, colonIdx).trim();
        const val = bullet.slice(colonIdx + 1).trim();
        result[key] = val;
      }
    }
  }
  return result;
}

/** Collect all bullet-point items from consecutive lines */
export function collectBulletItems(
  lines: TextLine[],
  startIdx: number
): { items: string[]; nextIdx: number } {
  const items: string[] = [];
  let i = startIdx;
  while (i < lines.length) {
    const bullet = isBulletLine(lines[i]);
    if (bullet) {
      items.push(bullet);
      i++;
    } else {
      break;
    }
  }
  return { items, nextIdx: i };
}

/** Collect lines until the next section header or numbered entry */
export function collectUntil(
  lines: TextLine[],
  startIdx: number,
  stopCondition: (line: TextLine, idx: number) => boolean
): { collected: TextLine[]; nextIdx: number } {
  const collected: TextLine[] = [];
  let i = startIdx;
  while (i < lines.length) {
    if (stopCondition(lines[i], i)) break;
    collected.push(lines[i]);
    i++;
  }
  return { collected, nextIdx: i };
}

/** Parse a line's segments into columns based on header x-positions */
export function mapToColumns(
  line: TextLine,
  columnXPositions: number[],
  tolerance = 25
): string[] {
  const result: string[] = new Array(columnXPositions.length).fill("");
  for (const seg of line.segments) {
    let bestCol = -1;
    let bestDist = Infinity;
    for (let c = 0; c < columnXPositions.length; c++) {
      const dist = Math.abs(seg.x - columnXPositions[c]);
      if (dist < tolerance && dist < bestDist) {
        bestDist = dist;
        bestCol = c;
      }
    }
    if (bestCol >= 0) {
      result[bestCol] = result[bestCol]
        ? result[bestCol] + " " + seg.text.trim()
        : seg.text.trim();
    } else {
      // Try to assign to the closest column to the left
      for (let c = columnXPositions.length - 1; c >= 0; c--) {
        if (seg.x >= columnXPositions[c] - tolerance) {
          result[c] = result[c]
            ? result[c] + " " + seg.text.trim()
            : seg.text.trim();
          break;
        }
      }
    }
  }
  return result;
}

/** Find a header row and extract column x-positions */
export function findColumnHeaders(
  lines: TextLine[],
  expectedHeaders: string[]
): { headerIndex: number; columnXPositions: number[] } | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const matchCount = expectedHeaders.filter((h) =>
      line.fullText.includes(h)
    ).length;
    if (matchCount >= Math.ceil(expectedHeaders.length * 0.5)) {
      const columnXPositions = expectedHeaders.map((h) => {
        for (const seg of line.segments) {
          if (seg.text.includes(h)) return seg.x;
        }
        return -1;
      });
      if (columnXPositions.every((x) => x >= 0)) {
        return { headerIndex: i, columnXPositions };
      }
    }
  }
  return null;
}
