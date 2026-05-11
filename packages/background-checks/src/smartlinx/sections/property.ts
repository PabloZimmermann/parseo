import type { TextLine, BoundingBox } from "@parseo/shared";
import { toBBox } from "@parseo/shared";
import type {
  RealPropertyRecord,
  MortgageInfo,
  LegalInfo,
  PersonalPropertyRecord,
  VehicleRegistrant,
  VehicleOwner,
  LienHolder,
  WatercraftInfo,
} from "../types.js";
import type { Section } from "@parseo/shared";
import { isNumberedEntry, parseDate, parseCurrency, parseNum } from "@parseo/shared";

// ── Real Property ─────────────────────────────────────────────────────────────

// Column zones for real property sub-sections (approximate x-positions from PDF)
const COL1_X = 72;   // Owner Info column
const COL2_X = 316;  // Mortgage Info 1 / Legal Info column
const COL3_X = 560;  // Mortgage Info 2 / Legal Info column

function classifySegmentColumn(x: number): 0 | 1 | 2 {
  if (x < 200) return 0;
  if (x < 450) return 1;
  return 2;
}

export function parseRealProperty(section: Section): RealPropertyRecord[] {
  const records: RealPropertyRecord[] = [];
  const lines = section.lines;

  let i = 0;
  while (i < lines.length && isNumberedEntry(lines[i]) === null) i++;

  while (i < lines.length) {
    const entryNum = isNumberedEntry(lines[i]);
    if (entryNum === null) { i++; continue; }

    const bb: Record<string, BoundingBox> = {};
    const record: RealPropertyRecord = {
      number: entryNum,
      street: "",
      city: "",
      state: "",
      zip: "",
      county: "",
      source: "",
      status: "",
      purchasePrice: null,
      salePrice: null,
      owners: [],
      mortgages: [],
      legalInfo: {},
      boundingBoxes: bb,
    };

    let rawSalePrice = "";
    let rawPurchasePrice = "";

    // Parse main entry line
    // Table columns: No.(~60) | Address(~115) | Status(~362) | Price(~546) | State(~709)
    let addressSegX = -1;
    for (const seg of lines[i].segments) {
      const t = seg.text.trim();
      if (t.match(/^\d+\.$/)) continue;
      if (t === "Current" || t === "Prior") { record.status = t; bb.status = toBBox(seg, lines[i]); continue; }
      if (t.match(/^\$[\d,]+/)) {
        if (!rawSalePrice) { rawSalePrice = t; bb.salePrice = toBBox(seg, lines[i]); }
        else { rawPurchasePrice = t; bb.purchasePrice = toBBox(seg, lines[i]); }
        continue;
      }
      if (t.match(/^[A-Z]{2}$/) && seg.x > 650) { record.state = t; bb.state = toBBox(seg, lines[i]); continue; }
      // Address is the segment after the number (x ~115)
      if (seg.x > 100 && seg.x < 300 && !record.street) {
        record.street = t;
        bb.street = toBBox(seg, lines[i]);
        addressSegX = seg.x;
      }
    }

    i++;

    // Map x-position ranges to sub-section types. Updated when header lines are encountered.
    // Each entry: { xMin, xMax, type: "owner"|"mortgage"|"legal", mortgageIdx }
    type ColMapping = { xMin: number; xMax: number; type: "owner" | "mortgage" | "legal"; mortgageIdx?: number };
    let activeCols: ColMapping[] = [];

    while (i < lines.length && isNumberedEntry(lines[i]) === null) {
      const ft = lines[i].fullText.trim();
      const segments = lines[i].segments;

      // Detect sub-section header lines by scanning segments
      let isHeaderLine = false;
      const newCols: ColMapping[] = [];

      for (const seg of segments) {
        const t = seg.text.trim();
        if (t.startsWith("Owner Info") || t === "Owner Info") {
          isHeaderLine = true;
          newCols.push({ xMin: seg.x - 10, xMax: seg.x + 200, type: "owner" });
        }
        if (t.match(/^Mortgage Info\s*\d*/)) {
          isHeaderLine = true;
          const idx = record.mortgages.length;
          record.mortgages.push(createEmptyMortgage());
          newCols.push({ xMin: seg.x - 10, xMax: seg.x + 200, type: "mortgage", mortgageIdx: idx });
        }
        if (t.startsWith("Legal Info") || t === "Legal Info") {
          isHeaderLine = true;
          newCols.push({ xMin: seg.x - 10, xMax: seg.x + 200, type: "legal" });
        }
      }

      if (isHeaderLine) {
        // Sort by xMin and set xMax boundaries
        newCols.sort((a, b) => a.xMin - b.xMin);
        for (let c = 0; c < newCols.length - 1; c++) {
          newCols[c].xMax = newCols[c + 1].xMin;
        }
        if (newCols.length > 0) {
          newCols[newCols.length - 1].xMax = 999;
        }
        activeCols = newCols;
        i++;
        continue;
      }

      // If we have column mappings, parse data using x-positions
      if (activeCols.length > 0) {
        for (const seg of segments) {
          const t = seg.text.trim();
          const bulletText = t.replace(/^[•·]\s*/, "");
          const colonIdx = bulletText.indexOf(":");

          // Find which column this segment belongs to
          const col = activeCols.find(c => seg.x >= c.xMin && seg.x < c.xMax);

          if (colonIdx <= 0) {
            // Non-bullet in owner column: first occurrence is the owner name,
            // subsequent lines are their address (which we skip)
            if (col?.type === "owner") {
              // Only add if it looks like a person name (not an address or city/state)
              const isPersonName = t.match(/^[A-Z][a-z]+,\s*[A-Z][a-z]/) && !t.match(/\d{5}/);
              const isAddress = t.match(/^\d+\s+\w/) || t.match(/^[A-Z][\w\s]+,\s*[A-Z]{2}\s+\d{5}/) || t.match(/^PO Box/i);
              if (isPersonName && !isAddress && !record.owners.includes(t)) {
                record.owners.push(t);
              }
            }
            continue;
          }

          const key = bulletText.slice(0, colonIdx).trim();
          const val = bulletText.slice(colonIdx + 1).trim();

          if (col?.type === "mortgage" && col.mortgageIdx !== undefined) {
            applyMortgageField(record.mortgages[col.mortgageIdx], key, val);
          } else if (col?.type === "legal") {
            applyLegalField(record.legalInfo, key, val);
          } else if (col?.type === "owner") {
            // KV in owner column — skip (owner addresses, etc.)
          } else {
            // No column mapping - try heuristic: legal keys go to legal, mortgage keys to last mortgage
            const kl = key.toLowerCase();
            if (kl.includes("parcel") || kl.includes("assessment") || kl.includes("sale price") ||
                kl.includes("sale date") || kl.includes("document type") || kl.includes("assessed value") ||
                kl.includes("market") || kl.includes("type of address") || kl.includes("mortgage lender")) {
              applyLegalField(record.legalInfo, key, val);
            } else if (kl.includes("loan") || kl.includes("lender") || kl.includes("recording") || kl.includes("contract") || kl.includes("transaction")) {
              const lastM = record.mortgages[record.mortgages.length - 1];
              if (lastM) applyMortgageField(lastM, key, val);
            }
          }
        }
        i++;
        continue;
      }

      // Pre-header lines: address continuation, city/state/zip, county, source
      // Use only the first segment (at address column x) to avoid picking up mortgage data

      // Address continuation (multi-line addresses at x ~115)
      const firstSeg = segments[0];
      const firstText = firstSeg?.text.trim() ?? "";

      // City, State ZIP on its own line
      const cityMatch = firstText.match(/^([A-Za-z\s]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/);
      if (cityMatch && !record.city) {
        record.city = cityMatch[1].trim();
        if (!record.state) record.state = cityMatch[2];
        record.zip = cityMatch[3];
        bb.city = toBBox(firstSeg, lines[i]);
        bb.zip = toBBox(firstSeg, lines[i]);
        i++; continue;
      }

      // City, State without zip (zip on next line)
      const cityOnly = firstText.match(/^([A-Za-z\s]+),\s*([A-Z]{2})$/);
      if (cityOnly && !record.city && firstSeg.x > 100 && firstSeg.x < 300) {
        record.city = cityOnly[1].trim();
        if (!record.state) record.state = cityOnly[2];
        bb.city = toBBox(firstSeg, lines[i]);
        i++; continue;
      }

      // Standalone zip
      if (firstText.match(/^\d{5}(?:-\d{4})?$/) && !record.zip && firstSeg.x > 100 && firstSeg.x < 300) {
        record.zip = firstText;
        bb.zip = toBBox(firstSeg, lines[i]);
        i++; continue;
      }

      // Address continuation at the address column
      if (firstSeg.x > 100 && firstSeg.x < 300 && firstText.match(/^\d+\s+\w/) && !ft.match(/^\d+\.\s/)) {
        if (!record.street || record.street.match(/^[A-Z]{2}$/)) {
          // Replace bare state with actual address
          record.street = firstText;
          bb.street = toBBox(firstSeg, lines[i]);
        }
        i++; continue;
      }

      if (ft.match(/County$/i) && !ft.includes("Source") && !ft.includes("Owner")) {
        record.county = ft;
        bb.county = toBBox(firstSeg, lines[i]);
        i++; continue;
      }

      if (ft.startsWith("Source:")) {
        record.source = ft.replace("Source:", "").trim();
        bb.source = toBBox(firstSeg, lines[i]);
        i++; continue;
      }

      // Foreclosure notice
      if (ft.includes("Foreclosure") || ft.includes("Default")) {
        i++; continue;
      }

      i++;
    }

    record.salePrice = parseCurrency(rawSalePrice);
    record.purchasePrice = parseCurrency(rawPurchasePrice);

    records.push(record);
  }

  return records;
}

function createEmptyMortgage(): MortgageInfo {
  return {
    loanAmount: null,
    description: "",
    lenderName: "",
    loanType: "",
    recordingDate: null,
    contractDate: null,
    transactionType: "",
  };
}

function applyMortgageField(m: MortgageInfo, key: string, val: string) {
  const k = key.toLowerCase();
  if (k.includes("loan amount")) m.loanAmount = parseCurrency(val);
  else if (k.includes("description")) m.description = val;
  else if (k.includes("lender name") || k.includes("lender")) m.lenderName = val;
  else if (k.includes("loan type")) m.loanType = val;
  else if (k.includes("recording date")) m.recordingDate = parseDate(val);
  else if (k.includes("contract date")) m.contractDate = parseDate(val);
  else if (k.includes("transaction type")) m.transactionType = val;
}

function applyLegalField(legal: Partial<import("../types.js").LegalInfo>, key: string, val: string) {
  const k = key.toLowerCase();
  if (k.includes("parcel number")) legal.parcelNumber = val;
  else if (k.includes("assessment year")) legal.assessmentYear = parseNum(val);
  else if (k.includes("sale price")) legal.salePrice = parseCurrency(val);
  else if (k.includes("sale date")) legal.saleDate = parseDate(val);
  else if (k.includes("recording date")) legal.recordingDate = parseDate(val);
  else if (k.includes("document type")) legal.documentType = val;
  else if (k.includes("assessed value")) legal.assessedValue = parseCurrency(val);
  else if (k.includes("market land value")) legal.marketLandValue = parseCurrency(val);
  else if (k.includes("total market value")) legal.totalMarketValue = parseCurrency(val);
  else if (k.includes("type of address")) legal.typeOfAddress = val;
  else if (k.includes("mortgage lender")) legal.mortgageLenderName = val;
}

// ── Personal Property (Vehicles & Watercraft) ─────────────────────────────────
// 3-column layout with dynamic sub-section headers:
// Col 0 (x ~62-72): Vehicle/Watercraft Information
// Col 1 (x ~307-316): Source Information / Registrant
// Col 2 (x ~551-560): Registrant / Owner / Lien Holder

type PPColType = "vehicle" | "watercraft" | "source" | "registrant" | "owner" | "lienholder";

interface PPColMapping {
  xMin: number;
  xMax: number;
  type: PPColType;
  registrant?: VehicleRegistrant;
  owner?: VehicleOwner;
  lienHolder?: LienHolder;
}

function parseKV(text: string): { key: string; val: string } | null {
  const colonIdx = text.indexOf(":");
  if (colonIdx <= 0) return null;
  return { key: text.slice(0, colonIdx).trim(), val: text.slice(colonIdx + 1).trim() };
}

export function parsePersonalProperty(section: Section): PersonalPropertyRecord[] {
  const records: PersonalPropertyRecord[] = [];
  const lines = section.lines;

  let i = 0;
  while (i < lines.length && isNumberedEntry(lines[i]) === null) i++;

  while (i < lines.length) {
    const entryNum = isNumberedEntry(lines[i]);
    if (entryNum === null) { i++; continue; }

    const bb: Record<string, BoundingBox> = {};
    const record: PersonalPropertyRecord = {
      number: entryNum,
      type: "",
      status: "",
      year: null,
      make: "",
      model: "",
      vin: "",
      classType: "",
      basePrice: null,
      registrants: [],
      owners: [],
      lienHolders: [],
      watercraftInfo: null,
      boundingBoxes: bb,
    };

    let rawYearMake = "";
    let rawBasePrice = "";

    // Main table line: No. | Type | Status | Year/Make | Model | VIN | Jurisdiction
    for (const seg of lines[i].segments) {
      const t = seg.text.trim();
      if (t.match(/^\d+\.$/)) continue;
      if (t === "MVR" || t === "Watercraft") { record.type = t; bb.type = toBBox(seg, lines[i]); }
      if (t === "Current" || t === "Prior") { record.status = t; bb.status = toBBox(seg, lines[i]); }
      if (seg.x > 200 && seg.x < 400 && t.match(/^\d{4}/)) { rawYearMake = t; bb.year = toBBox(seg, lines[i]); bb.make = toBBox(seg, lines[i]); }
      if (seg.x > 400 && seg.x < 580) { record.model = t; bb.model = toBBox(seg, lines[i]); }
      if (seg.x > 580 && seg.x < 720 && t.match(/^[A-Z0-9]{10,}/)) { record.vin = t; bb.vin = toBBox(seg, lines[i]); }
    }

    i++;

    let activeCols: PPColMapping[] = [];

    while (i < lines.length && isNumberedEntry(lines[i]) === null) {
      const ft = lines[i].fullText.trim();
      if (ft.match(/^Page \d+ of \d+$/)) { i++; continue; }

      // Detect sub-section header lines
      let isHeaderLine = false;
      const newCols: PPColMapping[] = [];

      for (const seg of lines[i].segments) {
        const t = seg.text.trim();
        if (t.match(/^Vehicle Information$/)) {
          isHeaderLine = true;
          newCols.push({ xMin: seg.x - 10, xMax: 999, type: "vehicle" });
        }
        if (t.match(/^Watercraft Info$/)) {
          isHeaderLine = true;
          newCols.push({ xMin: seg.x - 10, xMax: 999, type: "watercraft" });
          if (!record.watercraftInfo) {
            record.watercraftInfo = {
              vesselServiceType: "", length: "", propulsion: "",
              registrationNumber: "", registrationStatus: "",
              registrationDate: null, expirationDate: null,
            };
          }
        }
        if (t.match(/^Source Information$/)) {
          isHeaderLine = true;
          newCols.push({ xMin: seg.x - 10, xMax: 999, type: "source" });
        }
        if (t.match(/^Registrant\s*\d*$/) || t.match(/^Registrant Info$/)) {
          isHeaderLine = true;
          const reg = createEmptyRegistrant();
          record.registrants.push(reg);
          newCols.push({ xMin: seg.x - 10, xMax: 999, type: "registrant", registrant: reg });
        }
        if (t.match(/^Owner\s*\d*$/)) {
          isHeaderLine = true;
          const own = createEmptyOwner();
          record.owners.push(own);
          newCols.push({ xMin: seg.x - 10, xMax: 999, type: "owner", owner: own });
        }
        if (t.match(/^Lien Holder\s*\d*$/)) {
          isHeaderLine = true;
          const lh: LienHolder = { name: "", address: "" };
          record.lienHolders.push(lh);
          newCols.push({ xMin: seg.x - 10, xMax: 999, type: "lienholder", lienHolder: lh });
        }
      }

      if (isHeaderLine) {
        newCols.sort((a, b) => a.xMin - b.xMin);
        for (let c = 0; c < newCols.length - 1; c++) {
          newCols[c].xMax = newCols[c + 1].xMin;
        }
        // Merge with existing: replace overlapping, add new
        for (const nc of newCols) {
          const existing = activeCols.findIndex(c => Math.abs(c.xMin - nc.xMin) < 50);
          if (existing >= 0) activeCols[existing] = nc;
          else activeCols.push(nc);
        }
        activeCols.sort((a, b) => a.xMin - b.xMin);
        for (let c = 0; c < activeCols.length - 1; c++) {
          activeCols[c].xMax = activeCols[c + 1].xMin;
        }
        if (activeCols.length > 0) activeCols[activeCols.length - 1].xMax = 999;
        i++;
        continue;
      }

      // Parse data segments using column mapping
      for (const seg of lines[i].segments) {
        const t = seg.text.trim();
        if (!t) continue;

        const col = activeCols.find(c => seg.x >= c.xMin && seg.x < c.xMax);
        if (!col) continue;

        const kv = parseKV(t);

        switch (col.type) {
          case "vehicle": {
            if (!kv) break;
            const k = kv.key.toLowerCase();
            if (k === "vin") { record.vin = kv.val; bb.vin = toBBox(seg, lines[i]); }
            else if (k === "year") { /* already from table */ }
            else if (k === "make") { /* already from table */ }
            else if (k === "model") { record.model = kv.val; bb.model = toBBox(seg, lines[i]); }
            else if (k.includes("class")) { record.classType = kv.val; bb.classType = toBBox(seg, lines[i]); }
            else if (k.includes("base price")) { rawBasePrice = kv.val; bb.basePrice = toBBox(seg, lines[i]); }
            break;
          }
          case "watercraft": {
            if (!kv || !record.watercraftInfo) break;
            const k = kv.key.toLowerCase();
            if (k.includes("vessel service")) { record.watercraftInfo.vesselServiceType = kv.val; bb.vesselServiceType = toBBox(seg, lines[i]); }
            else if (k.includes("length")) { record.watercraftInfo.length = kv.val; bb.watercraftLength = toBBox(seg, lines[i]); }
            else if (k.includes("propulsion")) { record.watercraftInfo.propulsion = kv.val; bb.propulsion = toBBox(seg, lines[i]); }
            break;
          }
          case "source":
            // Data Source: Governmental — we skip this
            break;
          case "registrant": {
            const reg = col.registrant;
            if (!reg) break;
            if (kv) {
              const k = kv.key.toLowerCase();
              if (k.includes("plate number") && !k.includes("previous")) reg.plateNumber = kv.val;
              else if (k === "license plate state") reg.licensePlateState = kv.val;
              else if (k === "license plate type") reg.licensePlateType = kv.val;
              else if (k.includes("original registration")) reg.originalRegistrationDate = parseDate(kv.val);
              else if (k.includes("latest registration")) reg.latestRegistrationDate = parseDate(kv.val);
              else if (k.includes("expiration")) reg.expirationDate = parseDate(kv.val);
              else if (k === "number") reg.plateNumber = kv.val; // watercraft reg number
              else if (k === "status") { /* reg status */ }
              else if (k === "state") reg.licensePlateState = kv.val;
              else if (k.includes("registration date") && !k.includes("original") && !k.includes("latest")) {
                reg.latestRegistrationDate = parseDate(kv.val);
              }
            } else {
              // Non-KV: name or address
              if (t.match(/^[A-Z][a-z]+,\s*[A-Z]/) && !reg.name) reg.name = t;
              else if (t.match(/^\d+\s+\w/) && !reg.address) reg.address = t;
              else if (t.match(/^[A-Z][\w\s]+,\s*[A-Z]{2}\s+\d{5}/)) {
                reg.address = reg.address ? reg.address + ", " + t : t;
              }
            }
            break;
          }
          case "owner": {
            const own = col.owner;
            if (!own) break;
            if (kv) {
              const k = kv.key.toLowerCase();
              if (k.includes("title number")) own.titleNumber = kv.val;
              else if (k.includes("title date")) own.titleDate = parseDate(kv.val);
            } else {
              if (t.match(/^[A-Z][a-z]+,\s*[A-Z]/) && !own.name) own.name = t;
              else if (t.match(/^\d+\s+\w/) && !own.address) own.address = t;
              else if (t.match(/^[A-Z][\w\s]+,\s*[A-Z]{2}\s+\d{5}/)) {
                own.address = own.address ? own.address + ", " + t : t;
              }
            }
            break;
          }
          case "lienholder": {
            const lh = col.lienHolder;
            if (!lh) break;
            // Lien holder: first line is name, then address
            if (!lh.name) lh.name = t;
            else if (t.match(/^\d+\s+\w/) || t.match(/^PO Box/i)) {
              lh.address = lh.address ? lh.address + ", " + t : t;
            } else if (t.match(/^[A-Z][\w\s]+,\s*[A-Z]{2}\s+\d{5}/)) {
              lh.address = lh.address ? lh.address + ", " + t : t;
            }
            break;
          }
        }
      }

      i++;
    }

    // Post-process watercraft: populate watercraftInfo registration fields from registrant
    if (record.watercraftInfo && record.registrants.length > 0) {
      const reg = record.registrants[0];
      if (reg.plateNumber && !record.watercraftInfo.registrationNumber) {
        record.watercraftInfo.registrationNumber = reg.plateNumber;
      }
      if (!record.watercraftInfo.registrationStatus) {
        record.watercraftInfo.registrationStatus = "ACTIVE";
      }
      if (reg.latestRegistrationDate && !record.watercraftInfo.registrationDate) {
        record.watercraftInfo.registrationDate = reg.latestRegistrationDate;
      }
      if (reg.expirationDate && !record.watercraftInfo.expirationDate) {
        record.watercraftInfo.expirationDate = reg.expirationDate;
      }
    }

    // Split yearMake into year and make
    const ymMatch = rawYearMake.match(/^(\d{4})\s*(.*)/);
    if (ymMatch) {
      record.year = parseNum(ymMatch[1]);
      record.make = ymMatch[2].trim();
    }
    record.basePrice = parseCurrency(rawBasePrice);

    records.push(record);
  }

  return records;
}

function createEmptyRegistrant(): VehicleRegistrant {
  return {
    name: "",
    address: "",
    plateNumber: "",
    licensePlateState: "",
    licensePlateType: "",
    originalRegistrationDate: null,
    latestRegistrationDate: null,
    expirationDate: null,
  };
}

function createEmptyOwner(): VehicleOwner {
  return { name: "", address: "", titleNumber: "", titleDate: null };
}

function applyRegistrantField(r: VehicleRegistrant, key: string, val: string, kl: string) {
  if (kl.includes("plate number")) r.plateNumber = val;
  else if (kl.includes("license plate state")) r.licensePlateState = val;
  else if (kl.includes("license plate type")) r.licensePlateType = val;
  else if (kl.includes("original registration")) r.originalRegistrationDate = val;
  else if (kl.includes("latest registration")) r.latestRegistrationDate = val;
  else if (kl.includes("expiration")) r.expirationDate = val;
}

function applyOwnerField(o: VehicleOwner, key: string, val: string, kl: string) {
  if (kl.includes("title number")) o.titleNumber = val;
  else if (kl.includes("title date")) o.titleDate = val;
}
