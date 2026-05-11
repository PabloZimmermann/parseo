/**
 * Parse an integer string, returning null for "-" or empty.
 */
export function parseIntOrNull(s: string | undefined): number | null {
  if (!s || s.trim() === "-" || s.trim() === "") return null;
  const n = parseInt(s.trim(), 10);
  return isNaN(n) ? null : n;
}

/**
 * Normalize a date string. Accepts MM/DD/YYYY, MM/YYYY, M/D/YYYY, etc.
 * Returns the string as-is (trimmed), or empty string.
 */
export function normalizeDate(s: string | undefined): string {
  if (!s) return "";
  const trimmed = s.trim();
  if (trimmed === "--/--" || trimmed === "-" || trimmed === "") return "";
  return trimmed;
}
