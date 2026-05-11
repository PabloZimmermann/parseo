import type { TextLine, BoundingBox } from "@parseo/shared";
import { toBBox } from "@parseo/shared";
import type {
  RelativeRecord,
  SecondDegreeRelative,
  PersonAssociateRecord,
  NeighborGroup,
  NeighborResident,
  BusinessConnectionRecord,
  EmployerRecord,
  BusinessAssociateRecord,
} from "../types.js";
import type { Section } from "@parseo/shared";
import { isNumberedEntry, parseDate, parseNum } from "@parseo/shared";

function parseKV(text: string): { key: string; val: string } | null {
  const colonIdx = text.indexOf(":");
  if (colonIdx <= 0) return null;
  return { key: text.slice(0, colonIdx).trim(), val: text.slice(colonIdx + 1).trim() };
}

// ── Possible Relatives ────────────────────────────────────────────────────────
// Table: No.(~60) | Name/Details(~113) | Address(~339) | Phone(~567)
// First-degree entries are numbered. After each, detail lines have:
//   (Possible Spouse/Sibling/etc.) at x ~113
//   LexID:, DOB:, SSN:, (Age:) at x ~113
//   "Second Degree Relatives" header, then similar sub-entries

export function parseRelatives(section: Section): RelativeRecord[] {
  const records: RelativeRecord[] = [];
  const lines = section.lines;

  let i = 0;
  while (i < lines.length && isNumberedEntry(lines[i]) === null) i++;

  while (i < lines.length) {
    const entryNum = isNumberedEntry(lines[i]);
    if (entryNum === null) { i++; continue; }

    const bb: Record<string, BoundingBox> = {};
    const record: RelativeRecord = {
      number: entryNum,
      name: "",
      relationship: "",
      lexId: "",
      dob: null,
      age: null,
      ssn: "",
      address: "",
      phone: "",
      deceased: false,
      secondDegreeRelatives: [],
      boundingBoxes: bb,
    };

    let rawDob = "";
    let rawAge = "";

    // Main line: No. | Name | Address | Phone
    for (const seg of lines[i].segments) {
      const t = seg.text.trim();
      if (t.match(/^\d+\.$/)) continue;
      if (seg.x > 100 && seg.x < 300 && !record.name) { record.name = t; bb.name = toBBox(seg, lines[i]); }
      if (seg.x > 300 && seg.x < 550) { record.address = appendAddr(record.address, t); if (!bb.address) bb.address = toBBox(seg, lines[i]); }
      if (seg.x > 550 && t.match(/\d{3}-\d{3}-\d{4}/)) { record.phone = t; bb.phone = toBBox(seg, lines[i]); }
    }

    i++;

    let inSecondDegree = false;
    let currentSecDeg: SecondDegreeRelative | null = null;

    while (i < lines.length && isNumberedEntry(lines[i]) === null) {
      const ft = lines[i].fullText.trim();
      if (ft.match(/^Page \d+ of \d+$/)) { i++; continue; }

      if (ft.includes("Second Degree Relatives")) {
        inSecondDegree = true;
        i++;
        continue;
      }

      if (!inSecondDegree) {
        // First-degree detail lines
        for (const seg of lines[i].segments) {
          const t = seg.text.trim();

          // Relationship
          const relMatch = t.match(/^\(Possible\s+(\w+)\)$/);
          if (relMatch) { record.relationship = relMatch[1]; bb.relationship = toBBox(seg, lines[i]); continue; }

          // Age
          const ageMatch = t.match(/^\(Age:\s*(\d+)\)$/);
          if (ageMatch) { rawAge = ageMatch[1]; bb.age = toBBox(seg, lines[i]); continue; }

          // Deceased
          if (t === "Deceased") { record.deceased = true; bb.deceased = toBBox(seg, lines[i]); continue; }

          // KV fields at name column (x ~113)
          const kv = parseKV(t);
          if (kv) {
            if (kv.key === "LexID") { record.lexId = kv.val; bb.lexId = toBBox(seg, lines[i]); }
            else if (kv.key === "DOB") { rawDob = kv.val; bb.dob = toBBox(seg, lines[i]); }
            else if (kv.key === "SSN") { record.ssn = kv.val; bb.ssn = toBBox(seg, lines[i]); }
            continue;
          }

          // Address continuation at address column (x ~339)
          if (seg.x > 300 && seg.x < 550) {
            record.address = appendAddr(record.address, t);
          }
        }
      } else {
        // Second-degree relatives
        // Names are at x ~113, addresses at x ~339
        let isNewPerson = false;

        for (const seg of lines[i].segments) {
          const t = seg.text.trim();

          // Check if this is a new person name at the name column
          if (seg.x > 100 && seg.x < 300 && t.match(/^[A-Z][a-z]+,\s*[A-Z]/) && !parseKV(t)) {
            currentSecDeg = {
              name: t,
              lexId: "",
              dob: null,
              age: null,
              ssn: "",
              address: "",
              deceased: false,
            };
            record.secondDegreeRelatives.push(currentSecDeg);
            isNewPerson = true;
          }
        }

        // Now process all segments for the current second-degree relative
        for (const seg of lines[i].segments) {
          const t = seg.text.trim();
          if (!currentSecDeg) continue;

          // Skip the name we already parsed
          if (isNewPerson && seg.x > 100 && seg.x < 300 && t === currentSecDeg.name) continue;

          const kv = parseKV(t);
          if (kv) {
            if (kv.key === "LexID") currentSecDeg.lexId = kv.val;
            else if (kv.key === "DOB") currentSecDeg.dob = parseDate(kv.val);
            else if (kv.key === "SSN") currentSecDeg.ssn = kv.val;
            continue;
          }

          const ageMatch = t.match(/^\(Age:\s*(\d+)\)$/) || t.match(/^\(Age at Death:\s*(\d+)/);
          if (ageMatch) { currentSecDeg.age = parseNum(ageMatch[1]); continue; }

          if (t === "Deceased") { currentSecDeg.deceased = true; continue; }

          // Address at address column
          if (seg.x > 300 && seg.x < 550) {
            currentSecDeg.address = appendAddr(currentSecDeg.address, t);
          }
        }
      }

      i++;
    }

    record.dob = parseDate(rawDob);
    record.age = parseNum(rawAge);

    records.push(record);
  }

  return records;
}

function appendAddr(existing: string, newPart: string): string {
  if (!existing) return newPart;
  if (existing.includes(newPart)) return existing;
  return existing + ", " + newPart;
}

// ── Person Associates ─────────────────────────────────────────────────────────
// Table: No.(~60) | Full Name/Details(~115) | Address(~363) | Role(~641)

export function parsePersonAssociates(section: Section): PersonAssociateRecord[] {
  const records: PersonAssociateRecord[] = [];
  const lines = section.lines;

  let i = 0;
  while (i < lines.length && isNumberedEntry(lines[i]) === null) i++;

  while (i < lines.length) {
    const entryNum = isNumberedEntry(lines[i]);
    if (entryNum === null) { i++; continue; }

    const bb: Record<string, BoundingBox> = {};
    const record: PersonAssociateRecord = {
      number: entryNum,
      name: "",
      address: "",
      role: "",
      lexId: "",
      dob: null,
      age: null,
      ssn: "",
      phone: "",
      deceased: false,
      boundingBoxes: bb,
    };

    let rawDob = "";
    let rawAge = "";

    // Main line: No. | Name | Address | Role
    for (const seg of lines[i].segments) {
      const t = seg.text.trim();
      if (t.match(/^\d+\.$/)) continue;
      if (seg.x > 100 && seg.x < 340 && !record.name) { record.name = t; bb.name = toBBox(seg, lines[i]); }
      if (seg.x > 340 && seg.x < 620) { record.address = appendAddr(record.address, t); if (!bb.address) bb.address = toBBox(seg, lines[i]); }
      if (seg.x > 620) { record.role = t; bb.role = toBBox(seg, lines[i]); }
    }

    i++;

    while (i < lines.length && isNumberedEntry(lines[i]) === null) {
      const ft = lines[i].fullText.trim();
      if (ft.match(/^Page \d+ of \d+$/)) { i++; continue; }

      for (const seg of lines[i].segments) {
        const t = seg.text.trim();

        if (t === "Deceased") { record.deceased = true; bb.deceased = toBBox(seg, lines[i]); continue; }

        const ageMatch = t.match(/^\(Age:\s*(\d+)\)$/) || t.match(/^\(Age at Death:\s*(\d+)/);
        if (ageMatch) { rawAge = ageMatch[1]; bb.age = toBBox(seg, lines[i]); continue; }

        const kv = parseKV(t);
        if (kv) {
          if (kv.key === "LexID") { record.lexId = kv.val; bb.lexId = toBBox(seg, lines[i]); }
          else if (kv.key === "DOB") { rawDob = kv.val; bb.dob = toBBox(seg, lines[i]); }
          else if (kv.key === "SSN") { record.ssn = kv.val; bb.ssn = toBBox(seg, lines[i]); }
          continue;
        }

        // Address continuation at address column
        if (seg.x > 340 && seg.x < 620) {
          record.address = appendAddr(record.address, t);
        }
      }

      i++;
    }

    record.dob = parseDate(rawDob);
    record.age = parseNum(rawAge);

    records.push(record);
  }

  return records;
}

// ── Neighbors ─────────────────────────────────────────────────────────────────
// Structure:
//   "Found Near:" header
//   Address lines
//   Then numbered entries with residents
//   Each resident: name at x ~115, address at x ~339

export function parseNeighbors(section: Section): NeighborGroup[] {
  const groups: NeighborGroup[] = [];
  const lines = section.lines;

  let currentGroup: NeighborGroup | null = null;
  let i = 0;

  while (i < lines.length) {
    const ft = lines[i].fullText.trim();
    if (ft.match(/^Page \d+ of \d+$/)) { i++; continue; }

    if (ft.startsWith("Found Near")) {
      i++;
      const addrParts: string[] = [];
      while (i < lines.length) {
        const lt = lines[i].fullText.trim();
        if (lt.match(/^Page \d+ of \d+$/)) { i++; continue; }
        if (lt.includes("Records Found") || lt.includes("No.") || isNumberedEntry(lines[i]) !== null) break;
        if (lt) addrParts.push(lt);
        i++;
      }
      currentGroup = { address: addrParts.join(", "), residents: [], boundingBoxes: {} };
      groups.push(currentGroup);
      continue;
    }

    const entryNum = isNumberedEntry(lines[i]);
    if (entryNum !== null && currentGroup) {
      // New neighbor entry - first resident on main line
      let currentResident: NeighborResident | null = null;

      // Main line: address at x ~339
      for (const seg of lines[i].segments) {
        const t = seg.text.trim();
        if (t.match(/^\d+\.$/)) continue;
        if (seg.x > 100 && seg.x < 300 && t.match(/^[A-Z][a-z]+,\s*[A-Z]/)) {
          currentResident = { name: t, ssn: "", lexId: "", dob: null, age: null, deceased: false };
          currentGroup.residents.push(currentResident);
        }
      }

      i++;

      // Detail lines and additional residents within this entry
      while (i < lines.length && isNumberedEntry(lines[i]) === null) {
        const eft = lines[i].fullText.trim();
        if (eft.match(/^Page \d+ of \d+$/)) { i++; continue; }
        if (eft.startsWith("Found Near")) break;

        // Check if this line starts a new resident (name at x ~113 without KV format)
        let newResident = false;
        for (const seg of lines[i].segments) {
          const t = seg.text.trim();
          if (seg.x > 100 && seg.x < 300 && t.match(/^[A-Z][a-z]+,\s*[A-Z]/) && !parseKV(t)) {
            currentResident = { name: t, ssn: "", lexId: "", dob: null, age: null, deceased: false };
            currentGroup.residents.push(currentResident);
            newResident = true;
          }
        }

        // Parse detail fields for current resident
        if (currentResident) {
          for (const seg of lines[i].segments) {
            const t = seg.text.trim();
            if (newResident && t === currentResident.name) continue;

            const kv = parseKV(t);
            if (kv) {
              if (kv.key === "SSN") currentResident.ssn = kv.val;
              else if (kv.key === "LexID") currentResident.lexId = kv.val;
              else if (kv.key === "DOB") currentResident.dob = parseDate(kv.val);
            }

            const ageMatch = t.match(/^\(Age:\s*(\d+)\)$/) || t.match(/^\(Age at Death:\s*(\d+)/);
            if (ageMatch) currentResident.age = parseNum(ageMatch[1]);
            if (t === "Deceased") currentResident.deceased = true;
          }
        }

        i++;
      }
      continue;
    }

    i++;
  }

  return groups;
}

// ── Business Connections ──────────────────────────────────────────────────────
// Table: No.(~60) | Name(~115) | Address(~520) | Title(~712)

export function parseBusinessConnections(section: Section): BusinessConnectionRecord[] {
  const records: BusinessConnectionRecord[] = [];
  const lines = section.lines;

  let i = 0;
  while (i < lines.length && isNumberedEntry(lines[i]) === null) i++;

  while (i < lines.length) {
    const entryNum = isNumberedEntry(lines[i]);
    if (entryNum === null) { i++; continue; }

    const bb: Record<string, BoundingBox> = {};
    const record: BusinessConnectionRecord = {
      number: entryNum,
      name: "",
      address: "",
      title: "",
      boundingBoxes: bb,
    };

    for (const seg of lines[i].segments) {
      const t = seg.text.trim();
      if (t.match(/^\d+\.$/)) continue;
      if (seg.x > 100 && seg.x < 500 && !record.name) { record.name = t; bb.name = toBBox(seg, lines[i]); }
      if (seg.x > 500 && seg.x < 700) { record.address = appendAddr(record.address, t); if (!bb.address) bb.address = toBBox(seg, lines[i]); }
      if (seg.x > 700) { record.title = t; bb.title = toBBox(seg, lines[i]); }
    }

    i++;

    while (i < lines.length && isNumberedEntry(lines[i]) === null) {
      const ft = lines[i].fullText.trim();
      if (ft.match(/^Page \d+ of \d+$/)) { i++; continue; }

      for (const seg of lines[i].segments) {
        const t = seg.text.trim();
        if (seg.x > 500 && seg.x < 700) {
          record.address = appendAddr(record.address, t);
        }
      }

      i++;
    }

    records.push(record);
  }

  return records;
}

// ── Possible Employers ────────────────────────────────────────────────────────
// Table: No.(~60) | Name(~115) | Address(~520?) | Phone(~?)

export function parseEmployers(section: Section): EmployerRecord[] {
  const records: EmployerRecord[] = [];
  const lines = section.lines;

  // Detect column positions from header
  let nameX = 115, addrX = 340, phoneX = 567;
  for (const line of lines) {
    for (const seg of line.segments) {
      const t = seg.text.trim();
      if (t === "Name") nameX = seg.x;
      if (t === "Address") addrX = seg.x;
      if (t === "Phone") phoneX = seg.x;
    }
  }

  let i = 0;
  while (i < lines.length && isNumberedEntry(lines[i]) === null) i++;

  while (i < lines.length) {
    const entryNum = isNumberedEntry(lines[i]);
    if (entryNum === null) { i++; continue; }

    const bb: Record<string, BoundingBox> = {};
    const record: EmployerRecord = {
      number: entryNum,
      name: "",
      address: "",
      phone: "",
      boundingBoxes: bb,
    };

    for (const seg of lines[i].segments) {
      const t = seg.text.trim();
      if (t.match(/^\d+\.$/)) continue;
      if (Math.abs(seg.x - nameX) < 30 && !record.name) { record.name = t; bb.name = toBBox(seg, lines[i]); }
      if (Math.abs(seg.x - addrX) < 30) { record.address = appendAddr(record.address, t); if (!bb.address) bb.address = toBBox(seg, lines[i]); }
      if (Math.abs(seg.x - phoneX) < 30 && t.match(/\d{3}/)) { record.phone = t; bb.phone = toBBox(seg, lines[i]); }
    }

    i++;

    while (i < lines.length && isNumberedEntry(lines[i]) === null) {
      const ft = lines[i].fullText.trim();
      if (ft.match(/^Page \d+ of \d+$/)) { i++; continue; }

      for (const seg of lines[i].segments) {
        const t = seg.text.trim();
        if (Math.abs(seg.x - addrX) < 30) {
          record.address = appendAddr(record.address, t);
        }
      }

      i++;
    }

    records.push(record);
  }

  return records;
}

// ── Business Associates ───────────────────────────────────────────────────────
// Table: No.(~60) | Name(~115) | Address(~520?) | Role(~700?)

export function parseBusinessAssociates(section: Section): BusinessAssociateRecord[] {
  const records: BusinessAssociateRecord[] = [];
  const lines = section.lines;

  // Detect columns from header
  let nameX = 115, addrX = 340, roleX = 641;
  for (const line of lines) {
    for (const seg of line.segments) {
      const t = seg.text.trim();
      if (t === "Name") nameX = seg.x;
      if (t === "Address") addrX = seg.x;
      if (t === "Role") roleX = seg.x;
    }
  }

  let i = 0;
  while (i < lines.length && isNumberedEntry(lines[i]) === null) i++;

  while (i < lines.length) {
    const entryNum = isNumberedEntry(lines[i]);
    if (entryNum === null) { i++; continue; }

    const bb: Record<string, BoundingBox> = {};
    const record: BusinessAssociateRecord = {
      number: entryNum,
      name: "",
      address: "",
      role: "",
      boundingBoxes: bb,
    };

    for (const seg of lines[i].segments) {
      const t = seg.text.trim();
      if (t.match(/^\d+\.$/)) continue;
      if (Math.abs(seg.x - nameX) < 30 && !record.name) { record.name = t; bb.name = toBBox(seg, lines[i]); }
      if (Math.abs(seg.x - addrX) < 30) { record.address = appendAddr(record.address, t); if (!bb.address) bb.address = toBBox(seg, lines[i]); }
      if (Math.abs(seg.x - roleX) < 30) { record.role = t; bb.role = toBBox(seg, lines[i]); }
    }

    i++;

    while (i < lines.length && isNumberedEntry(lines[i]) === null) {
      const ft = lines[i].fullText.trim();
      if (ft.match(/^Page \d+ of \d+$/)) { i++; continue; }

      for (const seg of lines[i].segments) {
        const t = seg.text.trim();
        if (Math.abs(seg.x - addrX) < 30) {
          record.address = appendAddr(record.address, t);
        }
      }

      i++;
    }

    records.push(record);
  }

  return records;
}
