import type { TextLine, BoundingBox } from "@parseo/shared";
import { toBBox } from "@parseo/shared";
import type {
  EducationRecord,
  CriminalRecord,
  BankruptcyRecord,
  JudgmentLienRecord,
  UCCFilingRecord,
} from "../types.js";
import type { Section } from "@parseo/shared";
import { isNumberedEntry, parseDate, parseDateRange, parseCurrency, parseNum } from "@parseo/shared";

function parseKV(text: string): { key: string; val: string } | null {
  const colonIdx = text.indexOf(":");
  if (colonIdx <= 0) return null;
  return { key: text.slice(0, colonIdx).trim(), val: text.slice(colonIdx + 1).trim() };
}

// ── Education ─────────────────────────────────────────────────────────────────
// Structure: numbered entry, then Address block, then Details block with bullet KVs

export function parseEducation(section: Section): EducationRecord[] {
  const records: EducationRecord[] = [];
  const lines = section.lines;

  // Skip to table header, then first entry
  let i = 0;
  while (i < lines.length && isNumberedEntry(lines[i]) === null) i++;

  while (i < lines.length) {
    const entryNum = isNumberedEntry(lines[i]);
    if (entryNum === null) { i++; continue; }

    const bb: Record<string, BoundingBox> = {};
    const record: EducationRecord = {
      school: "",
      dateRange: { from: null, to: null },
      level: "",
      address: "",
      graduationYear: null,
      yearsSinceGraduation: null,
      boundingBoxes: bb,
    };

    let rawDateRange = "";
    let rawGradYear = "";
    let rawYearsSince = "";

    // Main line may have: No. | School | To-From | Level
    for (const seg of lines[i].segments) {
      const t = seg.text.trim();
      if (t.match(/^\d+\.$/)) continue;
      if (t.match(/\d{2}\/\d{2}\/\d{4}/)) { rawDateRange = t; bb.dateRange = toBBox(seg, lines[i]); }
    }

    i++;

    while (i < lines.length && isNumberedEntry(lines[i]) === null) {
      const ft = lines[i].fullText.trim();
      if (ft.match(/^Page \d+ of \d+$/)) { i++; continue; }
      if (ft === "Address:" || ft === "Details") { i++; continue; }

      for (const seg of lines[i].segments) {
        const t = seg.text.trim();
        const kv = parseKV(t);
        if (kv) {
          const k = kv.key.toLowerCase();
          if (k.includes("graduation year")) {
            rawGradYear = kv.val;
            record.level = k.includes("hs") ? "High School" : "College";
            bb.graduationYear = toBBox(seg, lines[i]);
            bb.level = toBBox(seg, lines[i]);
          } else if (k.includes("years since")) {
            rawYearsSince = kv.val;
            bb.yearsSinceGraduation = toBBox(seg, lines[i]);
          }
        } else if (t.match(/^\d+\s+\w/) || t.match(/^PO Box/i)) {
          record.address = (record.address ? record.address + ", " : "") + t;
          if (!bb.address) bb.address = toBBox(seg, lines[i]);
        } else if (t.match(/^[A-Z][\w\s]+,\s*[A-Z]{2}\s+\d{5}/)) {
          record.address = (record.address ? record.address + ", " : "") + t;
          if (!bb.address) bb.address = toBBox(seg, lines[i]);
        }
      }

      i++;
    }

    record.dateRange = parseDateRange(rawDateRange);
    record.graduationYear = parseNum(rawGradYear);
    record.yearsSinceGraduation = parseNum(rawYearsSince);

    records.push(record);
  }

  return records;
}

// ── Criminal/Arrest ───────────────────────────────────────────────────────────
// Table: No. | Name | Type | Offense | Date | State
// Then: Details (col 0) and Offense 1/2 (col 1) blocks

export function parseCriminalArrest(section: Section): CriminalRecord[] {
  const records: CriminalRecord[] = [];
  const lines = section.lines;

  // Detect column positions from header row
  let nameX = 115, typeX = 217, offenseX = 284, dateX = 647, stateX = 732;
  for (const line of lines) {
    for (const seg of line.segments) {
      const t = seg.text.trim();
      if (t === "Name" && seg.x > 100 && seg.x < 200) nameX = seg.x;
      if (t.startsWith("Type") && seg.x > 150) typeX = seg.x;
      if (t === "Offense" && seg.x > 200) offenseX = seg.x;
      if (t.startsWith("Date") && seg.x > 500) dateX = seg.x;
      if (t.startsWith("State") && seg.x > 600) stateX = seg.x;
    }
    if (line.fullText.includes("Offense")) break;
  }
  // Boundary between name and type columns
  const nameTypeBoundary = (nameX + typeX) / 2;

  let i = 0;
  while (i < lines.length && isNumberedEntry(lines[i]) === null) i++;

  while (i < lines.length) {
    const entryNum = isNumberedEntry(lines[i]);
    if (entryNum === null) { i++; continue; }

    const bb: Record<string, BoundingBox> = {};
    const record: CriminalRecord = {
      number: entryNum,
      name: "",
      type: "",
      offense: "",
      date: null,
      state: "",
      dataSource: "",
      address: "",
      offenses: [],
      boundingBoxes: bb,
    };

    let rawDate = "";

    // Parse table row using detected column positions
    for (const seg of lines[i].segments) {
      const t = seg.text.trim();
      if (t.match(/^\d+\.$/)) continue;

      if (seg.x >= nameX - 10 && seg.x < nameTypeBoundary) { record.name = t; bb.name = toBBox(seg, lines[i]); }
      else if (seg.x >= dateX - 20 && seg.x < stateX - 10 && t.match(/^\d{2}\/\d{2}\/\d{4}$/)) { rawDate = t; bb.date = toBBox(seg, lines[i]); }
      else if (seg.x >= stateX - 10) { record.state = t; bb.state = toBBox(seg, lines[i]); }
      else if (seg.x >= nameTypeBoundary && seg.x < dateX - 20) {
        // Type and Offense zone — may be merged: "Criminal OFFENSE TEXT"
        const typePrefix = t.match(/^(Criminal|Arrest|Traffic)\s+(.+)/i);
        if (typePrefix) {
          record.type = typePrefix[1];
          record.offense = record.offense ? record.offense + " " + typePrefix[2] : typePrefix[2];
          bb.type = toBBox(seg, lines[i]);
          bb.offense = toBBox(seg, lines[i]);
        } else if (/^(Criminal|Arrest|Traffic)$/i.test(t)) {
          record.type = t;
          bb.type = toBBox(seg, lines[i]);
        } else {
          record.offense = record.offense ? record.offense + " " + t : t;
          if (!bb.offense) bb.offense = toBBox(seg, lines[i]);
        }
      }
    }

    i++;

    // Detail and offense blocks
    while (i < lines.length && isNumberedEntry(lines[i]) === null) {
      const ft = lines[i].fullText.trim();
      if (ft.match(/^Page \d+ of \d+$/)) { i++; continue; }
      if (ft === "Details" || ft.match(/^Offense\s*\d*$/)) { i++; continue; }

      for (const seg of lines[i].segments) {
        const t = seg.text.trim();
        const kv = parseKV(t);
        if (!kv) continue;

        const k = kv.key;
        const v = kv.val;

        if (k === "Data Source") { record.dataSource = v; bb.dataSource = toBBox(seg, lines[i]); }
        else if (k === "Name") { record.name = v; bb.name = toBBox(seg, lines[i]); }
        else if (k === "Address") { record.address = v; bb.address = toBBox(seg, lines[i]); }
        else if (k === "Offense Date") {
          record.offenses.push({ description: record.offense, date: parseDate(v) });
        }
      }

      i++;
    }

    record.date = parseDate(rawDate);

    // If no offenses were parsed from Offense Date bullets, add the main one
    if (record.offenses.length === 0 && record.offense) {
      record.offenses.push({ description: record.offense, date: record.date });
    }

    records.push(record);
  }

  return records;
}

// ── Bankruptcy ────────────────────────────────────────────────────────────────

export function parseBankruptcy(section: Section): BankruptcyRecord[] {
  const records: BankruptcyRecord[] = [];
  const lines = section.lines;

  for (const line of lines) {
    if (line.fullText.includes("0 active") && line.fullText.includes("0 closed")) {
      return records;
    }
  }

  let i = 0;
  while (i < lines.length && isNumberedEntry(lines[i]) === null) i++;

  while (i < lines.length) {
    const entryNum = isNumberedEntry(lines[i]);
    if (entryNum === null) { i++; continue; }

    const bb: Record<string, BoundingBox> = {};
    const record: BankruptcyRecord = {
      number: entryNum,
      type: "",
      status: "",
      filingDate: null,
      caseNumber: "",
      chapter: "",
      jurisdiction: "",
      petitioners: [],
      attorneys: [],
      trustees: [],
      filingStatus: "",
      filingType: "",
      comment: "",
      statusDate: null,
      boundingBoxes: bb,
    };

    let rawFilingDate = "";
    let rawStatusDate = "";

    // Main table line: No. | Type | Status | Filing Date | Case Number | Jurisdiction
    for (const seg of lines[i].segments) {
      const t = seg.text.trim();
      if (t.match(/^\d+\.$/)) continue;
      if (t.includes("Chapter")) { record.type = t; bb.type = toBBox(seg, lines[i]); }
      if (t === "Closed" || t === "Open" || t === "Active" || t === "Discharged") { record.status = t; bb.status = toBBox(seg, lines[i]); }
      if (t.match(/^\d{2}\/\d{2}\/\d{4}$/)) { rawFilingDate = t; bb.filingDate = toBBox(seg, lines[i]); }
      if (t.match(/^\d{5,}$/)) { record.caseNumber = t; bb.caseNumber = toBBox(seg, lines[i]); }
      if (t.match(/^[A-Z][a-z]/) && t.length > 3 && !t.includes("Chapter")) { record.jurisdiction = t; bb.jurisdiction = toBBox(seg, lines[i]); }
    }

    i++;

    // Detail lines with 3-column layout: Petitioner | Bankruptcy Info / Attorney | Attorney / Trustee
    let currentSubSection = "";

    while (i < lines.length && isNumberedEntry(lines[i]) === null) {
      const ft = lines[i].fullText.trim();
      if (ft.match(/^Page \d+ of \d+$/)) { i++; continue; }

      // Sub-section headers
      for (const seg of lines[i].segments) {
        const t = seg.text.trim();
        if (t.match(/^Petitioner\s*\d*$/)) currentSubSection = "petitioner";
        if (t.match(/^Attorney\s*\d*$/)) currentSubSection = "attorney";
        if (t.match(/^Trustee\s*\d*$/)) currentSubSection = "trustee";
        if (t.match(/^Bankruptcy Information$/)) currentSubSection = "info";
        if (t.match(/^Status Information$/)) currentSubSection = "status";
      }

      for (const seg of lines[i].segments) {
        const t = seg.text.trim();
        const kv = parseKV(t);

        if (kv) {
          const k = kv.key.toLowerCase();
          if (k.includes("filing status")) { record.filingStatus = kv.val; bb.filingStatus = toBBox(seg, lines[i]); }
          else if (k.includes("filing type")) { record.filingType = kv.val; bb.filingType = toBBox(seg, lines[i]); }
          else if (k.includes("comment")) { record.comment = kv.val; bb.comment = toBBox(seg, lines[i]); }
          else if (k === "status") { record.filingStatus = kv.val; bb.filingStatus = toBBox(seg, lines[i]); }
          else if (k === "date") { rawStatusDate = kv.val; bb.statusDate = toBBox(seg, lines[i]); }
          else if (k === "type" && !record.type) { record.type = kv.val; bb.type = toBBox(seg, lines[i]); }
        } else if (t && !t.match(/^(Petitioner|Attorney|Trustee|Bankruptcy|Status)\s*\d*$/i)) {
          // Names/addresses in sub-sections
          if (currentSubSection === "petitioner") {
            const last = record.petitioners[record.petitioners.length - 1];
            if (t.match(/^[A-Z]/) && (!last || (last.name && last.address))) {
              record.petitioners.push({ name: t, address: "", type: "" });
            } else if (last) {
              if (t.match(/Type:/) ) last.type = t.replace(/.*Type:\s*/, "");
              else if (!last.address || last.address.match(/^\d/)) {
                last.address = last.address ? last.address + ", " + t : t;
              }
            }
          } else if (currentSubSection === "attorney") {
            const last = record.attorneys[record.attorneys.length - 1];
            if (t.match(/^[A-Z]/) && (!last || (last.name && last.address))) {
              record.attorneys.push({ name: t, address: "" });
            } else if (last) {
              last.address = last.address ? last.address + ", " + t : t;
            }
          } else if (currentSubSection === "trustee") {
            const last = record.trustees[record.trustees.length - 1];
            if (t.match(/^[A-Z]/) && (!last || (last.name && last.address))) {
              record.trustees.push({ name: t, address: "" });
            } else if (last) {
              last.address = last.address ? last.address + ", " + t : t;
            }
          }
        }
      }

      i++;
    }

    record.filingDate = parseDate(rawFilingDate);
    record.statusDate = parseDate(rawStatusDate);

    records.push(record);
  }

  return records;
}

// ── Judgments / Liens ─────────────────────────────────────────────────────────
// Table: No. | Type | Status | Amount | File Date | File Number | Jurisdiction
// Then: 3-column layout: Debtor 1 (~62) | Debtor 2 (~307) | Creditor 1 (~551)
// Then: Filing 1 (~551) with bullet KVs

export function parseJudgmentsLiens(section: Section): JudgmentLienRecord[] {
  const records: JudgmentLienRecord[] = [];
  const lines = section.lines;

  let i = 0;
  while (i < lines.length && isNumberedEntry(lines[i]) === null) i++;

  while (i < lines.length) {
    const entryNum = isNumberedEntry(lines[i]);
    if (entryNum === null) { i++; continue; }

    const bb: Record<string, BoundingBox> = {};
    const record: JudgmentLienRecord = {
      number: entryNum,
      type: "",
      status: "",
      amount: null,
      fileDate: null,
      fileNumber: "",
      jurisdiction: "",
      debtors: [],
      creditors: [],
      filingType: "",
      filingAgency: "",
      filingAgencyState: "",
      filingAgencyCounty: "",
      landlordTenantDispute: null,
      book: "",
      page: "",
      boundingBoxes: bb,
    };

    let rawAmount = "";
    let rawFileDate = "";

    // Parse table row segments
    for (const seg of lines[i].segments) {
      const t = seg.text.trim();
      if (t.match(/^\d+\.$/)) continue;

      if (seg.x > 100 && seg.x < 270 && t.includes("Judgment") || t.includes("Lien")) {
        if (t.includes("Judgment") || t.includes("Lien")) { record.type = t; bb.type = toBBox(seg, lines[i]); }
      }
      if (t === "See Details" || t === "Active" || t === "Released") { record.status = t; bb.status = toBBox(seg, lines[i]); }
      // Amount and date may be merged in one segment like "$5,250.00 09/22/2021"
      const amountMatch = t.match(/(\$[\d,.]+)/);
      if (amountMatch) { rawAmount = amountMatch[1]; bb.amount = toBBox(seg, lines[i]); }
      const dateMatch = t.match(/(\d{2}\/\d{2}\/\d{4})/);
      if (dateMatch && !rawFileDate) { rawFileDate = dateMatch[1]; bb.fileDate = toBBox(seg, lines[i]); }
      if (t.match(/^\d{4}[A-Z]/) || t.match(/^\d+[A-Z]{2}\d+/)) { record.fileNumber = t; bb.fileNumber = toBBox(seg, lines[i]); }
      if (["Florida", "Texas", "California", "New York"].some(s => t === s)) { record.jurisdiction = t; bb.jurisdiction = toBBox(seg, lines[i]); }
    }

    i++;

    // Sub-section parsing using column positions
    // Debtor/Creditor/Filing headers define the column mapping
    type ColType = "debtor" | "creditor" | "filing";
    const colMap: { xMin: number; xMax: number; type: ColType; idx: number }[] = [];
    let currentDebtorIdx = -1;

    while (i < lines.length && isNumberedEntry(lines[i]) === null) {
      const ft = lines[i].fullText.trim();
      if (ft.match(/^Page \d+ of \d+$/)) { i++; continue; }

      // Detect sub-section headers
      let isHeader = false;
      const newCols: typeof colMap = [];

      for (const seg of lines[i].segments) {
        const t = seg.text.trim();
        if (t.match(/^Debtor\s*\d*$/)) {
          isHeader = true;
          const idx = record.debtors.length;
          record.debtors.push({ name: "", address: "" });
          newCols.push({ xMin: seg.x - 10, xMax: 999, type: "debtor", idx });
        }
        if (t.match(/^Creditor\s*\d*$/)) {
          isHeader = true;
          const idx = record.creditors.length;
          record.creditors.push({ name: "", address: "" });
          newCols.push({ xMin: seg.x - 10, xMax: 999, type: "creditor", idx });
        }
        if (t.match(/^Filing\s*\d*$/)) {
          isHeader = true;
          newCols.push({ xMin: seg.x - 10, xMax: 999, type: "filing", idx: 0 });
        }
      }

      if (isHeader) {
        // Set boundaries
        newCols.sort((a, b) => a.xMin - b.xMin);
        for (let c = 0; c < newCols.length - 1; c++) {
          newCols[c].xMax = newCols[c + 1].xMin;
        }
        // Replace colMap entries, keeping existing ones for cols not redefined
        for (const nc of newCols) {
          // Remove old mappings that overlap
          const existing = colMap.findIndex(c => Math.abs(c.xMin - nc.xMin) < 50);
          if (existing >= 0) colMap[existing] = nc;
          else colMap.push(nc);
        }
        colMap.sort((a, b) => a.xMin - b.xMin);
        // Recalculate boundaries
        for (let c = 0; c < colMap.length - 1; c++) {
          colMap[c].xMax = colMap[c + 1].xMin;
        }
        if (colMap.length > 0) colMap[colMap.length - 1].xMax = 999;

        i++;
        continue;
      }

      // Parse data segments
      for (const seg of lines[i].segments) {
        const t = seg.text.trim();
        if (!t) continue;

        // Find which column this belongs to
        const col = colMap.find(c => seg.x >= c.xMin && seg.x < c.xMax);

        if (col?.type === "debtor") {
          const debtor = record.debtors[col.idx];
          if (debtor) {
            if (!debtor.name) debtor.name = t;
            else debtor.address = debtor.address ? debtor.address + ", " + t : t;
          }
        } else if (col?.type === "creditor") {
          const creditor = record.creditors[col.idx];
          if (creditor) {
            if (!creditor.name) creditor.name = t;
          }
        } else if (col?.type === "filing") {
          const kv = parseKV(t);
          if (kv) {
            const k = kv.key.toLowerCase();
            if (k === "type") { record.filingType = kv.val; bb.filingType = toBBox(seg, lines[i]); }
            else if (k === "agency") { record.filingAgency = kv.val; bb.filingAgency = toBBox(seg, lines[i]); }
            else if (k === "agency state") { record.filingAgencyState = kv.val; bb.filingAgencyState = toBBox(seg, lines[i]); }
            else if (k === "agency county") { record.filingAgencyCounty = kv.val; bb.filingAgencyCounty = toBBox(seg, lines[i]); }
            else if (k.includes("landlord")) {
              const v = kv.val.toLowerCase();
              record.landlordTenantDispute = v === "yes" || v === "true" ? true : v === "no" || v === "false" ? false : null;
              bb.landlordTenantDispute = toBBox(seg, lines[i]);
            }
            else if (k === "book") { record.book = kv.val; bb.book = toBBox(seg, lines[i]); }
            else if (k === "page") { record.page = kv.val; bb.page = toBBox(seg, lines[i]); }
            else if (k === "number") { record.fileNumber = record.fileNumber || kv.val; if (!bb.fileNumber) bb.fileNumber = toBBox(seg, lines[i]); }
          } else if (t.includes("Division")) {
            // "Division - West Palm Beach" continuation of agency
            record.filingAgency = record.filingAgency ? record.filingAgency + " " + t : t;
          }
        }
      }

      i++;
    }

    record.amount = parseCurrency(rawAmount);
    record.fileDate = parseDate(rawFileDate);

    records.push(record);
  }

  return records;
}

// ── UCC Filings ───────────────────────────────────────────────────────────────

export function parseUCCFilings(section: Section): UCCFilingRecord[] {
  const records: UCCFilingRecord[] = [];
  const lines = section.lines;

  for (const line of lines) {
    if (line.fullText.includes("0 debtor") && line.fullText.includes("0 creditor")) {
      return records;
    }
  }

  let i = 0;
  while (i < lines.length && isNumberedEntry(lines[i]) === null) i++;

  while (i < lines.length) {
    const entryNum = isNumberedEntry(lines[i]);
    if (entryNum === null) { i++; continue; }

    const bb: Record<string, BoundingBox> = {};
    const record: UCCFilingRecord = {
      number: entryNum,
      fileNumber: "",
      fileDate: null,
      status: "",
      securingParty: { name: "", address: "" },
      debtor: { name: "", address: "" },
      boundingBoxes: bb,
    };

    let rawFileDate = "";

    // Main table line
    for (const seg of lines[i].segments) {
      const t = seg.text.trim();
      if (t.match(/^\d+\.$/)) continue;
      if (t.match(/^\d{2}\/\d{2}\/\d{4}$/)) { rawFileDate = t; bb.fileDate = toBBox(seg, lines[i]); }
      if (t === "Active" || t === "Terminated") { record.status = t; bb.status = toBBox(seg, lines[i]); }
    }

    i++;

    let uccSubSection = "";
    while (i < lines.length && isNumberedEntry(lines[i]) === null) {
      for (const seg of lines[i].segments) {
        const t = seg.text.trim();
        if (t.match(/^Securing Party/i)) { uccSubSection = "securing"; continue; }
        if (t.match(/^Debtor/i)) { uccSubSection = "debtor"; continue; }

        const kv = parseKV(t);
        if (kv) {
          const k = kv.key.toLowerCase();
          if (k.includes("file number") || k === "number") { record.fileNumber = kv.val; bb.fileNumber = toBBox(seg, lines[i]); }
          else if (k.includes("file date")) { rawFileDate = kv.val; bb.fileDate = toBBox(seg, lines[i]); }
        } else if (t && !t.match(/^(Filing|Secured)\s/i)) {
          if (uccSubSection === "securing") {
            if (!record.securingParty.name) { record.securingParty.name = t; bb.securingPartyName = toBBox(seg, lines[i]); }
            else { record.securingParty.address = record.securingParty.address ? record.securingParty.address + ", " + t : t; if (!bb.securingPartyAddress) bb.securingPartyAddress = toBBox(seg, lines[i]); }
          } else if (uccSubSection === "debtor") {
            if (!record.debtor.name) { record.debtor.name = t; bb.debtorName = toBBox(seg, lines[i]); }
            else { record.debtor.address = record.debtor.address ? record.debtor.address + ", " + t : t; if (!bb.debtorAddress) bb.debtorAddress = toBBox(seg, lines[i]); }
          }
        }
      }
      i++;
    }

    record.fileDate = parseDate(rawFileDate);

    records.push(record);
  }

  return records;
}
