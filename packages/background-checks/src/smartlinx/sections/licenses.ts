import type { TextLine, BoundingBox } from "@parseo/shared";
import { toBBox } from "@parseo/shared";
import type { DriverLicense, OtherLicense } from "../types.js";
import type { Section } from "@parseo/shared";
import { isNumberedEntry, parseDate } from "@parseo/shared";

// Driver Licenses: 3-column layout
// Col 0 (x ~62-115): Personal Information (SSN, DOB, Gender, Height)
// Col 1 (x ~307-316): Driver Information (Data Source)
// Col 2 (x ~551-560): License Information (License Type, License Class)

function parseKV(text: string): { key: string; val: string } | null {
  const colonIdx = text.indexOf(":");
  if (colonIdx <= 0) return null;
  return { key: text.slice(0, colonIdx).trim(), val: text.slice(colonIdx + 1).trim() };
}

export function parseDriverLicenses(section: Section): DriverLicense[] {
  const records: DriverLicense[] = [];
  const lines = section.lines;

  let i = 0;
  while (i < lines.length && isNumberedEntry(lines[i]) === null) i++;

  while (i < lines.length) {
    const entryNum = isNumberedEntry(lines[i]);
    if (entryNum === null) { i++; continue; }

    const bb: Record<string, BoundingBox> = {};
    const license: DriverLicense = {
      name: "",
      address: "",
      status: "",
      issuedDate: null,
      expiresDate: null,
      location: "",
      ssn: "",
      dob: null,
      gender: "",
      height: "",
      dataSource: "",
      licenseType: "",
      licenseClass: "",
      boundingBoxes: bb,
    };

    let rawIssuedDate = "";
    let rawExpiresDate = "";
    let rawDob = "";

    // Main entry line: No. | Name | Status | Issued/Expired | Location
    for (const seg of lines[i].segments) {
      const t = seg.text.trim();
      if (t.match(/^\d+\.$/)) continue;
      if (seg.x > 100 && seg.x < 300 && !license.name) { license.name = t; bb.name = toBBox(seg, lines[i]); }
      if (t === "Historical" || t === "Current" || t === "Active") { license.status = t; bb.status = toBBox(seg, lines[i]); }
      if (t.match(/^[A-Z]{2}$/) && seg.x > 600) { license.location = t; bb.location = toBBox(seg, lines[i]); }
      if (t.startsWith("Issued:")) { rawIssuedDate = t.replace("Issued:", "").trim(); bb.issuedDate = toBBox(seg, lines[i]); }
      if (t.startsWith("Expires:")) { rawExpiresDate = t.replace("Expires:", "").trim(); bb.expiresDate = toBBox(seg, lines[i]); }
    }

    i++;

    // Continuation lines: address, then 3-column detail layout
    const addressParts: string[] = [];

    while (i < lines.length && isNumberedEntry(lines[i]) === null) {
      const ft = lines[i].fullText.trim();

      // Skip page markers
      if (ft.match(/^Page \d+ of \d+$/)) { i++; continue; }

      // Skip sub-section headers
      if (ft.includes("Personal Information") || ft.includes("Driver Information") || ft.includes("License Information")) {
        i++;
        continue;
      }

      // Process each segment by position
      for (const seg of lines[i].segments) {
        const t = seg.text.trim();
        if (!t) continue;

        const kv = parseKV(t);

        // Address continuation (x ~115, before detail sections)
        if (seg.x > 100 && seg.x < 200 && !kv) {
          // Could be address or part of name
          if (t.match(/^\d+\s+\w/) || t.match(/^[A-Z][a-z]+\s*(Ln|St|Ave|Ct|Dr|Blvd|Rd|Ter|Pl|Way)/)) {
            addressParts.push(t);
          } else if (t.match(/^[A-Z][\w\s]+,\s*[A-Z]{2}\s+\d{5}/)) {
            addressParts.push(t);
          }
        }

        if (!kv) {
          // Expires on its own line at issued/expired column
          if (t.startsWith("Expires:")) rawExpiresDate = t.replace("Expires:", "").trim();
          if (t.startsWith("Issued:")) rawIssuedDate = t.replace("Issued:", "").trim();
          continue;
        }

        const k = kv.key.toLowerCase();
        const v = kv.val;

        // Personal Information column (x ~72)
        if (k === "ssn") { license.ssn = v; bb.ssn = toBBox(seg, lines[i]); }
        else if (k === "dob") { rawDob = v.replace(/,\s*Age\s*\d+/, "").trim(); bb.dob = toBBox(seg, lines[i]); }
        else if (k === "gender") { license.gender = v; bb.gender = toBBox(seg, lines[i]); }
        else if (k === "height") { license.height = v; bb.height = toBBox(seg, lines[i]); }
        // Driver Information column (x ~316)
        else if (k === "data source") { license.dataSource = v; bb.dataSource = toBBox(seg, lines[i]); }
        // License Information column (x ~560)
        else if (k === "license type") { license.licenseType = v; bb.licenseType = toBBox(seg, lines[i]); }
        else if (k === "license class") { license.licenseClass = v; bb.licenseClass = toBBox(seg, lines[i]); }
        else if (k === "expires") { rawExpiresDate = v; bb.expiresDate = toBBox(seg, lines[i]); }
        else if (k === "issued") { rawIssuedDate = v; bb.issuedDate = toBBox(seg, lines[i]); }
        else if (k === "license no." || k === "license no") { /* stored in details if needed */ }
      }

      i++;
    }

    license.address = addressParts.join(", ");
    license.issuedDate = parseDate(rawIssuedDate);
    license.expiresDate = parseDate(rawExpiresDate);
    license.dob = parseDate(rawDob);

    // Append "Operator License" to class if it was split across lines
    if (license.licenseClass && !license.licenseClass.includes("Operator")) {
      // Check if next concept was split
    }

    records.push(license);
  }

  return records;
}

// Other Licenses: Voter, Professional, Sports
// These have varying detail layouts but follow a consistent pattern:
// Main line: No. | Type | Status | Issued/Expired | Location
// Detail lines: multi-column key-value pairs

export function parseOtherLicenses(section: Section): OtherLicense[] {
  const records: OtherLicense[] = [];
  const lines = section.lines;

  let i = 0;
  while (i < lines.length && isNumberedEntry(lines[i]) === null) i++;

  while (i < lines.length) {
    const entryNum = isNumberedEntry(lines[i]);
    if (entryNum === null) { i++; continue; }

    const obb: Record<string, BoundingBox> = {};
    const license: OtherLicense = {
      number: entryNum,
      type: "",
      status: "",
      issuedDate: null,
      expiresDate: null,
      location: "",
      name: "",
      address: "",
      lastVoted: null,
      party: "",
      licenseNumber: "",
      licenseType: "",
      homeState: "",
      boundingBoxes: obb,
    };

    let rawIssuedExpired = "";
    let rawLastVoted = "";
    let rawExpiresDate = "";

    // Parse main line segments
    for (const seg of lines[i].segments) {
      const t = seg.text.trim();
      if (t.match(/^\d+\.$/)) continue;
      if (["Voter", "Professional"].includes(t) || t.startsWith("Other")) { license.type = t; obb.type = toBBox(seg, lines[i]); }
      if (["Active", "Current", "Historical"].includes(t) || t.includes("Expired In Last Year")) { license.status = t; obb.status = toBBox(seg, lines[i]); }
      if (t.match(/^[A-Z]{2}$/) && seg.x > 600) { license.location = t; obb.location = toBBox(seg, lines[i]); }
      if (t.includes("Registration:") || t.includes("Issued:") || t.includes("Licensed:")) {
        rawIssuedExpired = t;
      }
    }

    i++;

    while (i < lines.length && isNumberedEntry(lines[i]) === null) {
      const ft = lines[i].fullText.trim();
      if (ft.match(/^Page \d+ of \d+$/)) { i++; continue; }

      // Skip section headers but don't skip their content
      if (ft === "Personal Information" || ft === "Personal Info" ||
          ft === "Voter Information" || ft === "Voter Info" ||
          ft === "License Info" || ft === "License Information") {
        i++;
        continue;
      }

      // Process all segments as key-value pairs → typed fields
      for (const seg of lines[i].segments) {
        const t = seg.text.trim();
        if (!t) continue;

        const kv = parseKV(t);
        if (kv) {
          const k = kv.key.toLowerCase();
          if (k === "last voted") { rawLastVoted = kv.val; obb.lastVoted = toBBox(seg, lines[i]); }
          else if (k === "party") { license.party = kv.val; obb.party = toBBox(seg, lines[i]); }
          else if (k === "license no." || k === "license no") { license.licenseNumber = kv.val; obb.licenseNumber = toBBox(seg, lines[i]); }
          else if (k === "license type") { license.licenseType = kv.val; obb.licenseType = toBBox(seg, lines[i]); }
          else if (k === "expires") { rawExpiresDate = kv.val; obb.expiresDate = toBBox(seg, lines[i]); }
          else if (k === "home state") { license.homeState = kv.val; obb.homeState = toBBox(seg, lines[i]); }
          else if (k === "license number") { license.licenseNumber = kv.val; obb.licenseNumber = toBBox(seg, lines[i]); }
        } else {
          // Non-KV content: names, addresses
          if (t.match(/^[A-Z][a-z]+,\s*[A-Z]/) && !license.name) {
            license.name = t;
          } else if (t.match(/^\d+\s+\w/) && !license.address) {
            license.address = t;
          } else if (t.match(/^[A-Z][\w\s]+,\s*[A-Z]{2}\s+\d{5}/)) {
            license.address = (license.address ? license.address + ", " : "") + t;
          }
        }
      }

      i++;
    }

    // Parse issuedExpired string like "Registration: 10/13/2006" or "Issued: 2017" or "Licensed: 07/25/2024"
    const issuedMatch = rawIssuedExpired.match(/(?:Registration|Issued|Licensed):\s*(.+)/);
    if (issuedMatch) {
      license.issuedDate = parseDate(issuedMatch[1].trim());
    }
    license.expiresDate = parseDate(rawExpiresDate);
    license.lastVoted = parseDate(rawLastVoted);

    records.push(license);
  }

  return records;
}
