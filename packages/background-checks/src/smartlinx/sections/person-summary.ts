import type { TextLine, BoundingBox } from "@parseo/shared";
import { toBBox } from "@parseo/shared";
import type {
  PersonSummary,
  AtAGlance,
  NameVariations,
  PhysicalDescription,
  PhoneRecord,
  ReportMetadata,
} from "../types.js";
import type { Section } from "@parseo/shared";
import {
  findLabelInText,
  isBulletLine,
  findColumnHeaders,
  mapToColumns,
  parseDate,
  parseDateRange,
  parseNum,
} from "@parseo/shared";

// ── Report Metadata (from top of first page before sections) ──────────────────

export function parseReportMetadata(allLines: TextLine[]): ReportMetadata {
  let generatedOn = "";
  let searchTerms = "";
  let reportCreatedFor = "";
  const bb: Record<string, BoundingBox> = {};

  for (const line of allLines.slice(0, 15)) {
    const ft = line.fullText;
    if (ft.includes("Generated On:")) {
      generatedOn = ft.replace(/.*Generated On:\s*/, "").split("|")[0].trim();
      for (const seg of line.segments) {
        if (seg.text.includes("Generated On:")) {
          bb.generatedOn = toBBox(seg, line);
        }
      }
    }
    if (ft.includes("Search Terms:")) {
      searchTerms = ft.replace(/.*Search Terms:\s*/, "").trim();
      for (const seg of line.segments) {
        if (seg.text.includes("Search Terms:")) {
          bb.searchTerms = toBBox(seg, line);
        }
      }
    }
    if (ft.includes("Report created for:")) {
      reportCreatedFor = ft.replace(/.*Report created for:\s*/, "").trim();
      for (const seg of line.segments) {
        if (seg.text.includes("Report created for:")) {
          bb.reportCreatedFor = toBBox(seg, line);
        }
      }
    }
  }

  return { generatedOn: parseDate(generatedOn), searchTerms, reportCreatedFor, boundingBoxes: bb };
}

// ── Person Summary ────────────────────────────────────────────────────────────

export function parsePersonSummary(section: Section): PersonSummary {
  const bb: Record<string, BoundingBox> = {};
  const result: PersonSummary = {
    name: "",
    location: "",
    age: null,
    lexId: "",
    ssn: "",
    gender: "",
    dob: null,
    currentAddress: "",
    addressDateRange: { from: null, to: null },
    county: "",
    phones: [],
    emails: [],
    boundingBoxes: bb,
  };

  let rawAge = "";
  let rawDob = "";
  let rawAddrDateRange = "";

  const lines = section.lines;

  for (let i = 0; i < lines.length; i++) {
    const ft = lines[i].fullText.trim();

    // Name: first non-empty line
    if (!result.name && ft && !ft.includes("LexID") && i < 3) {
      result.name = ft;
      if (lines[i].segments[0]) bb.name = toBBox(lines[i].segments[0], lines[i]);
      continue;
    }

    // Location and age: "Miami, FL | 37 Years"
    if (ft.includes("Years") && ft.includes("|")) {
      const parts = ft.split("|").map((s) => s.trim());
      result.location = parts[0];
      rawAge = parts[1];
      if (lines[i].segments[0]) bb.location = toBBox(lines[i].segments[0], lines[i]);
      if (lines[i].segments[0]) bb.age = toBBox(lines[i].segments[0], lines[i]);
      continue;
    }

    // Search all segments AND full text for key-value pairs
    // Format is "LexID  0065-8125-1321" either in one segment or as "Key  Value"
    const extractField = (text: string, label: string): string | null => {
      const re = new RegExp(`${label}\\s+(.+?)(?:\\s{2,}|$)`);
      const m = text.match(re);
      return m ? m[1].trim() : null;
    };

    // Check each segment for known labels
    for (const seg of lines[i].segments) {
      const st = seg.text.trim();
      if (st.startsWith("LexID") && !result.lexId) {
        result.lexId = st.replace(/^LexID\s*/, "").trim();
        bb.lexId = toBBox(seg, lines[i]);
      }
      if (st.startsWith("SSN") && !result.ssn) {
        result.ssn = st.replace(/^SSN\s*/, "").trim();
        bb.ssn = toBBox(seg, lines[i]);
      }
      if (st.startsWith("Gender") && !result.gender) {
        result.gender = st.replace(/^Gender\s*/, "").trim();
        bb.gender = toBBox(seg, lines[i]);
      }
      if (st.startsWith("DOB") && !rawDob) {
        rawDob = st.replace(/^DOB\s*/, "").replace(/;.*/, "").trim();
        bb.dob = toBBox(seg, lines[i]);
      }
      if (st.startsWith("County") && !result.county) {
        result.county = st.replace(/^County\s*/, "").trim();
        bb.county = toBBox(seg, lines[i]);
      }
    }

    // Also try full line text for fields that span segments
    if (!result.lexId) { const v = extractField(ft, "LexID"); if (v) { result.lexId = v; bb.lexId = toBBox(lines[i].segments[0], lines[i]); } }
    if (!result.ssn) { const v = extractField(ft, "SSN"); if (v) { result.ssn = v; bb.ssn = toBBox(lines[i].segments[0], lines[i]); } }
    if (!result.gender) { const v = extractField(ft, "Gender"); if (v) { result.gender = v; bb.gender = toBBox(lines[i].segments[0], lines[i]); } }
    if (!rawDob) {
      const v = extractField(ft, "DOB");
      if (v) { rawDob = v.replace(/;.*/, "").trim(); bb.dob = toBBox(lines[i].segments[0], lines[i]); }
    }
    if (!result.county) { const v = extractField(ft, "County"); if (v) { result.county = v; bb.county = toBBox(lines[i].segments[0], lines[i]); } }

    // Phones
    const phoneMatch = ft.match(/(\d{3}-\d{3}-\d{4})/);
    if (phoneMatch && !ft.includes("Phones(")) {
      const dateMatch = ft.match(/(\d{2}\/\d{4}\s*-\s*\d{2}\/\d{4})/);
      result.phones.push({
        number: phoneMatch[1],
        dateRange: parseDateRange(dateMatch?.[1] ?? ""),
      });
    }

    // Emails
    const emails = ft.match(/[\w.-]+@[\w.-]+\.\w+/g);
    if (emails) {
      for (const e of emails) {
        if (!result.emails.includes(e)) {
          result.emails.push(e);
          for (const seg of lines[i].segments) {
            if (seg.text.includes(e)) {
              bb[`email_${result.emails.length - 1}`] = toBBox(seg, lines[i]);
            }
          }
        }
      }
    }

    // Current address from Address segment
    for (const seg of lines[i].segments) {
      if (seg.text.includes("Address(")) {
        // The address is in later segments on the same line
        const addrSegs = lines[i].segments.filter(
          s => s.x > seg.x && !s.text.includes("Phones(") && !s.text.match(/\d{3}-\d{3}/)
        );
        if (addrSegs.length > 0) {
          result.currentAddress = addrSegs.map(s => s.text.trim()).join(" ");
          bb.currentAddress = toBBox(addrSegs[0], lines[i]);
        }
      }
    }

    // Address continuation on next line (city, state, zip)
    if (result.currentAddress && !result.currentAddress.includes("FL") && ft.match(/^Miami,\s*FL/)) {
      result.currentAddress += ", " + ft.replace(/\(.*\)/, "").trim();
    }

    // Date range for address
    const addrDateMatch = ft.match(/(\d{4})\s*-\s*(Current|\d{2}\/\d{4})/);
    if (addrDateMatch && ft.includes("Current") && !rawAddrDateRange) {
      rawAddrDateRange = addrDateMatch[0];
      bb.addressDateRange = toBBox(lines[i].segments[0], lines[i]);
    }
  }

  result.age = parseNum(rawAge);
  result.dob = parseDate(rawDob);
  result.addressDateRange = parseDateRange(rawAddrDateRange);

  return result;
}

// ── At a Glance ───────────────────────────────────────────────────────────────

export function parseAtAGlance(section: Section): AtAGlance {
  const bb: Record<string, BoundingBox> = {};
  const result: AtAGlance = {
    possibleRelatives: 0,
    businessConnections: 0,
    criminalArrest: 0,
    bankruptcy: 0,
    realProperty: 0,
    professionalLicenses: 0,
    personAssociates: 0,
    possibleEmployers: 0,
    businessAssociates: 0,
    judgmentsLiens: 0,
    personalProperty: 0,
    foreclosureNoticeOfDefault: 0,
    boundingBoxes: bb,
  };

  const labelMap: Record<string, keyof Omit<AtAGlance, "boundingBoxes">> = {
    "Possible Relatives": "possibleRelatives",
    "Business Connections": "businessConnections",
    "Criminal/Arrest": "criminalArrest",
    Bankruptcy: "bankruptcy",
    "Real Property": "realProperty",
    "Professional Licenses": "professionalLicenses",
    "Person Associates": "personAssociates",
    "Possible Employers": "possibleEmployers",
    "Business Associates": "businessAssociates",
    "Judgments/Liens": "judgmentsLiens",
    "Personal Property": "personalProperty",
    "Foreclosure/Notice of Default": "foreclosureNoticeOfDefault",
    "Real\nProperty": "realProperty",
    "Personal\nProperty": "personalProperty",
  };

  for (const line of section.lines) {
    for (const seg of line.segments) {
      const text = seg.text.trim();
      for (const [label, key] of Object.entries(labelMap)) {
        if (text.includes(label)) {
          // Number is in this segment after label, or in adjacent segment
          const numMatch = text.replace(label, "").match(/(\d+)/);
          if (numMatch) {
            result[key] = parseInt(numMatch[1], 10);
            bb[key] = toBBox(seg, line);
          }
        }
      }
    }
    // Also check for number-only segments adjacent to label segments
    for (let si = 0; si < line.segments.length; si++) {
      const seg = line.segments[si];
      const numOnly = seg.text.trim().match(/^(\d+)$/);
      if (numOnly && si > 0) {
        const prevText = line.segments[si - 1].text.trim();
        for (const [label, key] of Object.entries(labelMap)) {
          if (prevText.includes(label) || prevText.endsWith(label.split(" ").pop()!)) {
            result[key] = parseInt(numOnly[1], 10);
            bb[key] = toBBox(seg, line);
          }
        }
      }
    }
  }

  return result;
}

// ── Name Variations ───────────────────────────────────────────────────────────

export function parseNameVariations(section: Section): NameVariations {
  const bb: Record<string, BoundingBox> = {};
  const result: NameVariations = {
    names: [],
    ssnSummary: [],
    reportedDobs: [],
    boundingBoxes: bb,
  };

  // 3-column layout: Name Variations (~72) | SSN Summary (~308-318) | Reported DOBS (~553-563)
  // Detect column positions from header row
  let nameX = 72, ssnX = 318, dobsX = 563;
  for (const line of section.lines) {
    for (const seg of line.segments) {
      const t = seg.text.trim();
      if (t === "Name Variations") nameX = seg.x;
      if (t === "SSN Summary") ssnX = seg.x;
      if (t.includes("Reported DOB") || t.includes("Reported DOBS")) dobsX = seg.x;
    }
  }

  for (const line of section.lines) {
    // Skip header row
    if (line.fullText.includes("Name Variations") && line.fullText.includes("SSN Summary")) continue;

    for (const seg of line.segments) {
      const t = seg.text.trim();
      if (!t) continue;

      if (Math.abs(seg.x - nameX) < 30) {
        // Name column
        if (t.match(/^[A-Z][a-z]+,/)) {
          bb[`name_${result.names.length}`] = toBBox(seg, line);
          result.names.push(t);
        }
      } else if (Math.abs(seg.x - ssnX) < 30) {
        // SSN column
        if (t.match(/^\d{3}-\d{2}/)) {
          bb[`ssn_${result.ssnSummary.length}`] = toBBox(seg, line);
          result.ssnSummary.push({ ssn: t, issuedState: "", issuedYearRange: "" });
        } else if (t.includes("Issued in")) {
          const last = result.ssnSummary[result.ssnSummary.length - 1];
          if (last) {
            // Parse "Issued in Florida, 1989 - 1989"
            const m = t.match(/Issued in\s+([^,]+),?\s*(.*)/);
            if (m) {
              last.issuedState = m[1].trim();
              last.issuedYearRange = m[2].trim();
            }
          }
        }
      } else if (Math.abs(seg.x - dobsX) < 30) {
        // DOBs column
        if (t.match(/\d{2}\/\d{4}/)) {
          bb[`dob_${result.reportedDobs.length}`] = toBBox(seg, line);
          result.reportedDobs.push(parseDate(t));
        }
      }
    }
  }

  return result;
}

// ── Physical Description ──────────────────────────────────────────────────────

export function parsePhysicalDescription(section: Section): PhysicalDescription {
  const bb: Record<string, BoundingBox> = {};
  const result: PhysicalDescription = {
    hairColor: "",
    eyeColor: "",
    height: "",
    weight: "",
    scarsMarks: "",
    dateLastSeen: null,
    boundingBoxes: bb,
  };

  // The physical description table has: Label (x ~60) | Value (x ~287) | optional extra KV
  for (const line of section.lines) {
    for (const seg of line.segments) {
      const t = seg.text.trim();

      // Handle "Key: Value" format (e.g., "Date last seen: 12/2025")
      const kv = t.match(/^(.+?):\s*(.+)$/);
      if (kv) {
        const label = kv[1].trim().toLowerCase();
        if (label.includes("date last seen")) {
          result.dateLastSeen = parseDate(kv[2].trim());
          bb.dateLastSeen = toBBox(seg, line);
        }
        continue;
      }

      // Label-value pairs: label at x ~60, value at x ~287
      if (seg.x < 100) {
        // This is a label - find the corresponding value segment
        const valueSeg = line.segments.find(s => s.x > 250 && s.x < 350);
        if (!valueSeg) continue;
        const val = valueSeg.text.trim();

        if (t === "Hair Color") { result.hairColor = val; bb.hairColor = toBBox(valueSeg, line); }
        else if (t === "Eye Color") { result.eyeColor = val; bb.eyeColor = toBBox(valueSeg, line); }
        else if (t === "Height") { result.height = val; bb.height = toBBox(valueSeg, line); }
        else if (t === "Weight (lb)" || t === "Weight") { result.weight = val; bb.weight = toBBox(valueSeg, line); }
        else if (t === "Scars/Marks") { result.scarsMarks = val; bb.scarsMarks = toBBox(valueSeg, line); }
      }
    }
  }

  return result;
}

// ── Phones ────────────────────────────────────────────────────────────────────

export function parsePhones(section: Section): PhoneRecord[] {
  const records: PhoneRecord[] = [];
  const lines = section.lines;

  // Find the header row
  const headers = findColumnHeaders(lines, ["No.", "Phone", "To-From", "Line Type", "Listing Name", "Carrier"]);
  if (!headers) return records;

  const { headerIndex, columnXPositions } = headers;

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    const cols = mapToColumns(line, columnXPositions, 30);

    // A phone row starts with a number in the No. column
    const no = cols[0].match(/^\d+\.?$/);
    if (no) {
      // Phone number may be split across lines - start collecting
      let phoneNum = cols[1].replace(/[^0-9-]/g, "");
      let dateRange = cols[2];
      let lineType = cols[3];
      let listingName = cols[4];
      let carrier = cols[5];

      // Check next line(s) for continuation (phone number wrap, line type, etc.)
      while (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const nextCols = mapToColumns(nextLine, columnXPositions, 30);
        if (nextCols[0].match(/^\d+\.?$/)) break;
        if (nextLine.fullText.includes("Page ") && nextLine.fullText.includes(" of ")) {
          i++;
          continue;
        }
        if (nextCols[1]) phoneNum += nextCols[1].replace(/[^0-9-]/g, "");
        if (nextCols[2] && !dateRange) dateRange = nextCols[2];
        if (nextCols[3]) lineType = (lineType + " " + nextCols[3]).trim();
        if (nextCols[4]) listingName = (listingName + " " + nextCols[4]).trim();
        if (nextCols[5]) carrier = (carrier + " " + nextCols[5]).trim();
        i++;
      }

      // Clean: extract lineType tokens from dateRange (e.g., "02/2010 - 02/2026 Possible Wireless")
      const lineTypeTokens = dateRange.match(/(Possible\s+)?(Wireless|Landline|VoIP)/i);
      if (lineTypeTokens) {
        lineType = lineTypeTokens[0].trim();
        dateRange = dateRange.replace(lineTypeTokens[0], "").trim();
      }
      // Also strip trailing "Possible" from dateRange when lineType already captured it
      dateRange = dateRange.replace(/\s+Possible\s*$/i, "").trim();

      const phoneBb: Record<string, BoundingBox> = {};
      // Use the bounding box of the first segment of the row that started this phone
      if (line.segments[0]) phoneBb.number = toBBox(line.segments[0], line);

      records.push({
        number: phoneNum,
        dateRange: parseDateRange(dateRange),
        lineType,
        listingName,
        carrier,
        boundingBoxes: phoneBb,
      });
    }
  }

  return records;
}
