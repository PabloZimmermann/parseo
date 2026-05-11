import type { TextLine, BoundingBox } from "@parseo/shared";
import { toBBox } from "@parseo/shared";
import type { AddressRecord, NeighborhoodProfile, VerifyingSource } from "../types.js";
import type { Section } from "@parseo/shared";
import { isNumberedEntry, isBulletLine, parseDateRange, parseNum, parseCurrency } from "@parseo/shared";

function parseKV(text: string): { key: string; val: string } | null {
  const colonIdx = text.indexOf(":");
  if (colonIdx <= 0) return null;
  return { key: text.slice(0, colonIdx).trim(), val: text.slice(colonIdx + 1).trim() };
}

export function parseAddresses(section: Section): AddressRecord[] {
  const records: AddressRecord[] = [];
  const lines = section.lines;

  let i = 0;
  while (i < lines.length && !isNumberedEntry(lines[i])) i++;

  while (i < lines.length) {
    const entryNum = isNumberedEntry(lines[i]);
    if (entryNum === null) { i++; continue; }

    const bb: Record<string, BoundingBox> = {};
    const record: AddressRecord = {
      number: entryNum,
      street: "",
      city: "",
      state: "",
      zip: "",
      county: "",
      type: "",
      status: "",
      dateRange: { from: null, to: null },
      phone: "",
      householdMembers: [],
      namesAssociatedWithAddress: [],
      neighborhoodProfile: null,
      verifyingSourcesByType: [],
      boundingBoxes: bb,
    };

    let rawDateRange = "";

    // Parse main entry line segments
    for (const seg of lines[i].segments) {
      const t = seg.text.trim();
      if (t.match(/^\d+\.$/)) continue;
      if (t === "Current" || t === "Prior") { record.status = t; bb.status = toBBox(seg, lines[i]); continue; }
      if (t.match(/^\d{3}-\d{3}-\d{4}/)) { record.phone = t; bb.phone = toBBox(seg, lines[i]); continue; }
      if (t.match(/^\d{1,2}\/?\d{0,4}\s*-\s*\d/)) { rawDateRange = t; bb.dateRange = toBBox(seg, lines[i]); continue; }
      if (t.match(/^\d+\s+\w/) && !record.street) { record.street = t; bb.street = toBBox(seg, lines[i]); continue; }
      if (t.includes("(Current Residence)")) { record.status = "Current"; bb.status = toBBox(seg, lines[i]); continue; }
    }

    i++;

    while (i < lines.length && isNumberedEntry(lines[i]) === null) {
      const ft = lines[i].fullText.trim();
      if (ft.match(/^Page \d+ of \d+$/)) { i++; continue; }

      // Sub-section headers (may be in multi-column: "Neighborhood Profile  Verifying Sources by Type")
      const hasNeighborhood = lines[i].segments.some(s => s.text.includes("Neighborhood Profile"));
      const hasVerifying = lines[i].segments.some(s => s.text.includes("Verifying Sources"));
      const hasHousehold = lines[i].segments.some(s => s.text.includes("Possible Household Members"));
      const hasNameAssoc = lines[i].segments.some(s => s.text.includes("Name Associated") || s.text.includes("Names Associated"));

      if (hasNeighborhood || hasVerifying || hasHousehold) {
        // Multi-column sub-section header. Could be 2 or 3 columns:
        // "Neighborhood Profile  Verifying Sources by Type"
        // "Possible Household Members  Neighborhood Profile  Verifying Sources by Type"
        let householdX = -1, neighborhoodX = -1, verifyingX = -1;
        for (const seg of lines[i].segments) {
          if (seg.text.includes("Possible Household")) householdX = seg.x;
          if (seg.text.includes("Neighborhood Profile")) neighborhoodX = seg.x;
          if (seg.text.includes("Verifying Sources")) verifyingX = seg.x;
        }

        if (neighborhoodX >= 0) {
          record.neighborhoodProfile = { averageAge: null, medianHouseholdIncome: null, medianHomeValue: null, averageYearsOfEducation: null };
        }

        // Set column boundaries
        const boundaries: number[] = [];
        if (householdX >= 0) boundaries.push(householdX);
        if (neighborhoodX >= 0) boundaries.push(neighborhoodX);
        if (verifyingX >= 0) boundaries.push(verifyingX);
        boundaries.sort((a, b) => a - b);

        i++;

        while (i < lines.length && isNumberedEntry(lines[i]) === null) {
          const nft = lines[i].fullText.trim();
          if (nft.match(/^Page \d+ of \d+$/)) { i++; continue; }
          // Stop at next sub-section that isn't part of this multi-column block
          if (lines[i].segments.some(s =>
            (s.text.includes("Possible Household") && !hasHousehold) ||
            s.text.includes("Name Associated") ||
            s.text.includes("Names Associated"))) break;

          for (const seg of lines[i].segments) {
            const t = seg.text.trim();
            if (!t) continue;

            // Determine which column this segment belongs to
            let colType: "household" | "neighborhood" | "verifying" | null = null;
            if (householdX >= 0 && seg.x < (neighborhoodX >= 0 ? neighborhoodX - 10 : verifyingX >= 0 ? verifyingX - 10 : 999)) {
              colType = "household";
            } else if (neighborhoodX >= 0 && seg.x >= neighborhoodX - 10 && seg.x < (verifyingX >= 0 ? verifyingX - 10 : 999)) {
              colType = "neighborhood";
            } else if (verifyingX >= 0 && seg.x >= verifyingX - 10) {
              colType = "verifying";
            }

            if (colType === "household") {
              // Household member names
              const name = t.replace(/^[•·]\s*/, "");
              if (name.match(/^[A-Z][a-z]+,/) || name.match(/^[A-Z][a-z]+\s/)) {
                record.householdMembers.push(name);
              }
            } else if (colType === "neighborhood" && record.neighborhoodProfile) {
              const kv = parseKV(t);
              if (kv) {
                const k = kv.key.toLowerCase();
                if (k.includes("average age")) { record.neighborhoodProfile.averageAge = parseNum(kv.val); bb.neighborhoodAverageAge = toBBox(seg, lines[i]); }
                else if (k.includes("median household income")) { record.neighborhoodProfile.medianHouseholdIncome = parseCurrency(kv.val); bb.neighborhoodMedianHouseholdIncome = toBBox(seg, lines[i]); }
                else if (k.includes("median home value")) { record.neighborhoodProfile.medianHomeValue = parseCurrency(kv.val); bb.neighborhoodMedianHomeValue = toBBox(seg, lines[i]); }
                else if (k.includes("average years of education")) { record.neighborhoodProfile.averageYearsOfEducation = parseNum(kv.val); bb.neighborhoodAverageYearsOfEducation = toBBox(seg, lines[i]); }
              } else if (t.match(/^\$[\d,]+$/)) {
                if (record.neighborhoodProfile.medianHouseholdIncome === null) {
                  record.neighborhoodProfile.medianHouseholdIncome = parseCurrency(t);
                }
              }
            } else if (colType === "verifying") {
              // Accumulate raw verifying source text; we'll parse into structured form later
              (record as any)._rawVerifying = (record as any)._rawVerifying || [];
              (record as any)._rawVerifying.push(t);
            }
          }

          i++;
        }
        continue;
      }

      if (hasNameAssoc) {
        i++;
        while (i < lines.length) {
          const bullet = isBulletLine(lines[i]);
          if (bullet) { record.namesAssociatedWithAddress.push(bullet); i++; }
          else break;
        }
        continue;
      }

      // City, State, ZIP (may be on one line or split across two)
      const cityZipMatch = ft.match(/^([A-Za-z\s]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/);
      if (cityZipMatch && !record.city) {
        record.city = cityZipMatch[1].trim();
        record.state = cityZipMatch[2];
        record.zip = cityZipMatch[3];
        if (lines[i].segments[0]) bb.city = toBBox(lines[i].segments[0], lines[i]);
        i++; continue;
      }
      // City, State without zip (zip on next line)
      const cityOnlyMatch = ft.match(/^([A-Za-z\s]+),\s*([A-Z]{2})$/);
      if (cityOnlyMatch && !record.city) {
        record.city = cityOnlyMatch[1].trim();
        record.state = cityOnlyMatch[2];
        // Check next line for zip
        if (i + 1 < lines.length) {
          const nextFt = lines[i + 1].fullText.trim();
          if (nextFt.match(/^\d{5}(?:-\d{4})?$/)) {
            record.zip = nextFt;
            i += 2; continue;
          }
        }
        i++; continue;
      }
      // Standalone zip (after city/state was already parsed)
      if (ft.match(/^\d{5}(?:-\d{4})?$/) && record.city && !record.zip) {
        record.zip = ft;
        i++; continue;
      }

      // County
      if (ft.match(/County$/i) && !ft.includes("Household") && !ft.includes("Agency")) {
        record.county = ft.replace(/\(.*\)/, "").trim();
        if (lines[i].segments[0]) bb.county = toBBox(lines[i].segments[0], lines[i]);
        i++; continue;
      }

      // Type
      if (ft.match(/^\([\w\s,-]+\)$/)) {
        record.type = ft.replace(/[()]/g, "");
        if (lines[i].segments[0]) bb.type = toBBox(lines[i].segments[0], lines[i]);
        i++; continue;
      }

      // Date range
      const dateMatch = ft.match(/^(\d{1,2}\/?\d{0,4}\s*-\s*\d{1,2}\/?\d{0,4})/);
      if (dateMatch && !rawDateRange) {
        rawDateRange = dateMatch[1];
        i++; continue;
      }

      i++;
    }

    // Post-process: convert raw verifying source fragments into structured VerifyingSource[]
    const rawV: string[] = (record as any)._rawVerifying || [];
    delete (record as any)._rawVerifying;
    record.verifyingSourcesByType = parseVerifyingSources(rawV);

    record.dateRange = parseDateRange(rawDateRange);

    // Ensure neighborhoodProfile fields are null, not undefined
    if (record.neighborhoodProfile) {
      record.neighborhoodProfile.averageAge ??= null;
      record.neighborhoodProfile.medianHouseholdIncome ??= null;
      record.neighborhoodProfile.medianHomeValue ??= null;
      record.neighborhoodProfile.averageYearsOfEducation ??= null;
    }

    records.push(record);
  }

  return records;
}

/**
 * Join multi-line verifying source fragments into structured entries.
 * Input: ["CONSUMER REPORTING", "AGENCY 2 (1)", "DRIVERS LICENSE (1)", "OTHER REPORTING SOURCE", "(2)"]
 * Output: [{source: "CONSUMER REPORTING AGENCY 2", count: 1}, {source: "DRIVERS LICENSE", count: 1}, {source: "OTHER REPORTING SOURCE", count: 2}]
 */
function parseVerifyingSources(raw: string[]): VerifyingSource[] {
  // First, join fragments: a fragment like "AGENCY 2 (1)" or "(2)" belongs to the previous source
  const joined: string[] = [];
  for (const s of raw) {
    const trimmed = s.trim();
    if (!trimmed) continue;
    // If it's just a count like "(1)" or "(2)", append to previous
    if (trimmed.match(/^\(\d+\)$/)) {
      if (joined.length > 0) {
        joined[joined.length - 1] += " " + trimmed;
      }
    }
    // If it starts with "AGENCY" it's a continuation of the previous source name
    else if (trimmed.match(/^AGENCY\s+\d/)) {
      if (joined.length > 0) {
        joined[joined.length - 1] += " " + trimmed;
      } else {
        joined.push(trimmed);
      }
    } else {
      joined.push(trimmed);
    }
  }

  // Parse each joined string into {source, count}
  const results: VerifyingSource[] = [];
  for (const entry of joined) {
    const countMatch = entry.match(/\((\d+)\)\s*$/);
    const count = countMatch ? parseInt(countMatch[1], 10) : 0;
    const source = entry.replace(/\s*\(\d+\)\s*$/, "").trim();
    if (source) {
      results.push({ source, count });
    }
  }
  return results;
}
