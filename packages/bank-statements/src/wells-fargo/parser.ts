import { extractLines, parseCurrency, toBBox, UnrecognizedFormatError, MissingSectionError } from "@parseo/shared";
import type { TextLine, DateString, BoundingBox } from "@parseo/shared";
import type { WellsFargoStatement, AccountHolder, StatementSummary, Transaction } from "./types.js";

export async function parseWellsFargoStatement(buffer: Buffer): Promise<WellsFargoStatement> {
  const lines = await extractLines(buffer);
  return parseWellsFargoFromLines(lines);
}

export function parseWellsFargoFromLines(lines: TextLine[]): WellsFargoStatement {
  const head = lines.slice(0, 30).map((l) => l.fullText).join("\n");
  if (!/Wells\s*Fargo/i.test(head) && !/wellsfargo/i.test(head)) {
    throw new UnrecognizedFormatError(
      "WellsFargo",
      "first 30 lines do not contain a Wells Fargo signature"
    );
  }

  // Detect web export format (Spanish online banking export)
  if (/Detalle de la cuenta/i.test(head) || /Saldo disponible/i.test(head) || /Dep[óo]sitos\/cr[ée]ditos/i.test(head)) {
    return parseWebExport(lines);
  }

  const bb: Record<string, BoundingBox> = {};

  const { accountType, bbox: accountTypeBbox } = parseAccountType(lines);
  if (accountTypeBbox) bb.accountType = accountTypeBbox;

  const { statementDate, bbox: statementDateBbox } = parseStatementDate(lines);
  if (statementDateBbox) bb.statementDate = statementDateBbox;

  const year = statementDate?.slice(0, 4) ?? "";
  const accountHolder = parseAccountHolder(lines);
  const { accountNumber, bbox: accountNumberBbox } = parseAccountNumber(lines);
  if (accountNumberBbox) bb.accountNumber = accountNumberBbox;

  const { summary, statementPeriod } = parseSummary(lines, year);
  const transactions = parseTransactions(lines, year);

  return {
    accountHolder,
    accountNumber,
    accountType,
    statementDate,
    statementPeriod,
    summary,
    totalDeposits: summary.depositsCredits,
    totalWithdrawals: summary.withdrawalsDebits,
    transactions,
    boundingBoxes: bb,
  };
}

// ── Account type ────────────────────────────────────────────────────────────

function parseAccountType(lines: TextLine[]): { accountType: string; bbox: BoundingBox | null } {
  for (const line of lines.slice(0, 10)) {
    if (line.page !== 1) break;
    const text = line.fullText.trim();
    if (/checking|savings|money\s*market/i.test(text) && !/page/i.test(text)) {
      return { accountType: text, bbox: toBBox(line.segments[0], line) };
    }
  }
  return { accountType: "", bbox: null };
}

// ── Statement date ──────────────────────────────────────────────────────────

const MONTHS: Record<string, string> = {
  January: "01", February: "02", March: "03", April: "04",
  May: "05", June: "06", July: "07", August: "08",
  September: "09", October: "10", November: "11", December: "12",
  // Spanish
  enero: "01", febrero: "02", marzo: "03", abril: "04",
  mayo: "05", junio: "06", julio: "07", agosto: "08",
  septiembre: "09", octubre: "10", noviembre: "11", diciembre: "12",
};

const ALL_MONTH_NAMES = Object.keys(MONTHS).join("|");

function parseStatementDate(lines: TextLine[]): { statementDate: DateString; bbox: BoundingBox | null } {
  // English: "November 30, 2025"
  const enRx = new RegExp(`^(${ALL_MONTH_NAMES})\\s+(\\d{1,2}),\\s+(\\d{4})`, "i");
  // Spanish: "30 de noviembre de 2025"
  const esRx = new RegExp(`^(\\d{1,2})\\s+de\\s+(${ALL_MONTH_NAMES})\\s+de\\s+(\\d{4})`, "i");

  for (const line of lines.slice(0, 10)) {
    if (line.page !== 1) break;
    const enM = line.fullText.match(enRx);
    if (enM) {
      const month = MONTHS[enM[1]] ?? MONTHS[enM[1].toLowerCase()];
      const seg = line.segments.find((s) => s.text.includes(enM[1]));
      return {
        statementDate: `${enM[3]}-${month}-${enM[2].padStart(2, "0")}`,
        bbox: seg ? toBBox(seg, line) : null,
      };
    }
    const esM = line.fullText.match(esRx);
    if (esM) {
      const month = MONTHS[esM[2]] ?? MONTHS[esM[2].toLowerCase()];
      const seg = line.segments[0];
      return {
        statementDate: `${esM[3]}-${month}-${esM[1].padStart(2, "0")}`,
        bbox: seg ? toBBox(seg, line) : null,
      };
    }
  }
  return { statementDate: null, bbox: null };
}

// ── Account holder ──────────────────────────────────────────────────────────

function parseAccountHolder(lines: TextLine[]): AccountHolder {
  const bb: Record<string, BoundingBox> = {};
  const parts: { text: string; line: TextLine; seg: import("@parseo/shared").TextSegment }[] = [];

  for (const line of lines) {
    if (line.page !== 1) break;
    if (line.y < 100 || line.y > 350) continue;
    const leftSegs = line.segments.filter((s) => s.x < 200);
    if (leftSegs.length === 0) continue;
    const text = leftSegs.map((s) => s.text).join(" ").trim();
    if (text && !/Questions|Available|phone|relay|CALL|español|Online|Write|Box|Portland|Preguntas|Disponible|tel[ée]fono|retransmisi[oó]n|Internet|Escriba|P\.O\./i.test(text)) {
      parts.push({ text, line, seg: leftSegs[0] });
    }
  }

  const name = parts[0]?.text ?? "";
  if (parts[0]) bb.name = toBBox(parts[0].seg, parts[0].line);

  const addressTexts: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    addressTexts.push(parts[i].text);
    if (i === 1) bb.address = toBBox(parts[i].seg, parts[i].line);
  }

  return { name, address: addressTexts.join(", "), boundingBoxes: bb };
}

// ── Account number ──────────────────────────────────────────────────────────

function parseAccountNumber(lines: TextLine[]): { accountNumber: string; bbox: BoundingBox | null } {
  for (const line of lines) {
    // English: "Account number: 1234567890"
    // Spanish: "Número de cuenta: 1224371797 (cuenta principal)"
    const m = line.fullText.match(/(?:Account\s*number|N[úu]mero de cuenta):\s*(\d+)/i);
    if (m) {
      const seg = line.segments.find((s) => s.text.includes(m[1]));
      return { accountNumber: m[1], bbox: seg ? toBBox(seg, line) : null };
    }
  }
  return { accountNumber: "", bbox: null };
}

// ── Summary ─────────────────────────────────────────────────────────────────

function parseSummary(lines: TextLine[], year: string) {
  const bb: Record<string, BoundingBox> = {};
  let beginningBalance = 0;
  let depositsCredits = 0;
  let withdrawalsDebits = 0;
  let endingBalance = 0;
  let periodFrom: DateString = null;
  let periodTo: DateString = null;

  for (const line of lines) {
    const text = line.fullText;

    // English: "Beginning balance on 11/1"  |  Spanish: "Saldo inicial al 11/1"
    const beginM = text.match(/(?:Beginning balance on|Saldo inicial al)\s+(\d{1,2}\/\d{1,2})/i);
    if (beginM) {
      const { value, bbox } = parseCurrencySegment(line, 250);
      beginningBalance = value ?? 0;
      if (bbox) bb.beginningBalance = bbox;
      periodFrom = shortDateToISO(beginM[1], year);
      const labelSeg = line.segments.find((s) => /Beginning|Saldo inicial/i.test(s.text));
      if (labelSeg) bb.statementPeriodFrom = toBBox(labelSeg, line);
    }

    // English: "Deposits/Credits"  |  Spanish: "Depósitos/Créditos"
    if (/^(Deposits\/Credits|Dep[óo]sitos\/Cr[ée]ditos)/i.test(text)) {
      const { value, bbox } = parseCurrencySegment(line, 250);
      depositsCredits = value ?? 0;
      if (bbox) bb.depositsCredits = bbox;
    }

    // English: "Withdrawals/Debits"  |  Spanish: "Retiros/Débitos"
    if (/^(Withdrawals\/Debits|Retiros\/D[ée]bitos)/i.test(text)) {
      const { value, bbox } = parseCurrencySegment(line, 250);
      withdrawalsDebits = value ?? 0;
      if (bbox) bb.withdrawalsDebits = bbox;
    }

    // English: "Ending balance on 11/30"  |  Spanish: "Saldo final al 11/30"
    const endM = text.match(/(?:Ending balance on|Saldo final al)\s+(\d{1,2}\/\d{1,2})/i);
    if (endM) {
      const { value, bbox } = parseCurrencySegment(line, 250);
      endingBalance = value ?? 0;
      if (bbox) bb.endingBalance = bbox;
      periodTo = shortDateToISO(endM[1], year);
      const labelSeg = line.segments.find((s) => /Ending|Saldo final/i.test(s.text));
      if (labelSeg) bb.statementPeriodTo = toBBox(labelSeg, line);
    }
  }

  if (!periodFrom) {
    throw new MissingSectionError("WellsFargo", "Statement period activity summary");
  }

  return {
    summary: { beginningBalance, depositsCredits, withdrawalsDebits, endingBalance, boundingBoxes: bb } as StatementSummary,
    statementPeriod: { from: periodFrom, to: periodTo },
  };
}

function parseCurrencySegment(line: TextLine, minX: number): { value: number | null; bbox: BoundingBox | null } {
  for (const seg of line.segments) {
    if (seg.x >= minX) {
      const val = parseCurrency(seg.text.replace(/^-\s*/, "-"));
      if (val !== null) return { value: Math.abs(val), bbox: toBBox(seg, line) };
    }
  }
  return { value: null, bbox: null };
}

function shortDateToISO(shortDate: string, year: string): DateString {
  const parts = shortDate.split("/");
  if (parts.length === 2) {
    return `${year}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
  }
  return null;
}

// ── Transactions ────────────────────────────────────────────────────────────

const COL_DESC_MIN = 120;
const COL_DEPOSIT_MIN = 395;
const COL_WITHDRAWAL_MIN = 455;
const COL_BALANCE_MIN = 515;

function parseTransactions(lines: TextLine[], year: string): Transaction[] {
  let txStart = -1;
  for (let i = 0; i < lines.length; i++) {
    // English: "Transaction history"  |  Spanish: "Historial de transacciones"
    if (/^(Transaction history|Historial de transacciones)\b/i.test(lines[i].fullText)) {
      txStart = i;
      break;
    }
  }
  if (txStart < 0) return [];

  let i = txStart + 1;
  while (i < lines.length && !isTransactionLine(lines[i]) && !/^(Totals|Totales)/i.test(lines[i].fullText)) {
    i++;
  }

  const transactions: Transaction[] = [];
  let current: Transaction | null = null;

  while (i < lines.length) {
    const line = lines[i];
    const text = line.fullText;

    if (/^(Totals|Totales)\b/i.test(text)) break;
    if (/^(Monthly service fee|Overdraft Protection|Account transaction|IMPORTANT)/i.test(text)) break;
    if (/^(Protecci[oó]n contra Sobregiros|Cargo Mensual|Transacciones de la cuenta)/i.test(text)) break;
    if (new RegExp(`^(${ALL_MONTH_NAMES})\\s+\\d`, "i").test(text)) break;
    // Spanish page header "30 de noviembre de 2025" — skip, don't break
    if (/^\d{1,2}\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de\s+\d{4}$/i.test(text)) { i++; continue; }
    // Skip page number lines
    if (/^P[áa]gina\s+\d/i.test(text)) { i++; continue; }
    // Skip continuation headers and column header lines
    if (/^Historial de transacciones/i.test(text)) { i++; continue; }
    if (/^Fecha\s+(N[úu]mero|Número)/i.test(text)) { i++; continue; }
    if (/^\(mes\/dia/i.test(text)) { i++; continue; }
    if (/^Traducciones de t[ée]rminos/i.test(text)) { i++; continue; }
    if (/^[•·]\s/i.test(text)) { i++; continue; }
    if (/^(The Ending Daily Balance|El Saldo diario final)/i.test(text)) break;

    if (isTransactionLine(line)) {
      if (current) transactions.push(current);
      current = buildTransaction(line, year);
    } else if (current && isContinuationLine(line)) {
      const descText = line.segments
        .filter((s) => s.x < COL_DEPOSIT_MIN)
        .map((s) => s.text.trim())
        .join(" ");
      if (descText) {
        current.description += " " + descText;
      }
    }

    i++;
  }

  if (current) transactions.push(current);
  return transactions;
}

function isTransactionLine(line: TextLine): boolean {
  const firstSeg = line.segments[0];
  if (!firstSeg || firstSeg.x > 80) return false;
  return /^\d{1,2}\/\d{1,2}$/.test(firstSeg.text.trim());
}

function isContinuationLine(line: TextLine): boolean {
  const firstSeg = line.segments[0];
  if (!firstSeg) return false;
  return firstSeg.x >= COL_DESC_MIN && firstSeg.x <= 200;
}

function buildTransaction(line: TextLine, year: string): Transaction {
  const bb: Record<string, BoundingBox> = {};
  const dateSeg = line.segments[0];
  const date = shortDateToISO(dateSeg.text.trim(), year);
  bb.date = toBBox(dateSeg, line);

  let checkNumber = "";
  const descParts: string[] = [];
  let descBbox: BoundingBox | null = null;
  let depositsCredits: number | null = null;
  let withdrawalsDebits: number | null = null;
  let endingDailyBalance: number | null = null;

  for (let s = 1; s < line.segments.length; s++) {
    const seg = line.segments[s];
    const x = seg.x;
    const text = seg.text.trim();

    if (x >= COL_BALANCE_MIN) {
      endingDailyBalance = parseCurrency(text);
      if (endingDailyBalance !== null) bb.endingDailyBalance = toBBox(seg, line);
    } else if (x >= COL_WITHDRAWAL_MIN) {
      withdrawalsDebits = parseCurrency(text);
      if (withdrawalsDebits !== null) bb.withdrawalsDebits = toBBox(seg, line);
    } else if (x >= COL_DEPOSIT_MIN) {
      depositsCredits = parseCurrency(text);
      if (depositsCredits !== null) bb.depositsCredits = toBBox(seg, line);
    } else if (x >= COL_DESC_MIN) {
      descParts.push(text);
      if (!descBbox) descBbox = toBBox(seg, line);
    } else {
      checkNumber = text;
      bb.checkNumber = toBBox(seg, line);
    }
  }

  if (descBbox) bb.description = descBbox;

  return {
    date,
    checkNumber,
    description: descParts.join(" ").trim(),
    depositsCredits,
    withdrawalsDebits,
    endingDailyBalance,
    boundingBoxes: bb,
  };
}

// ── Web export format (Spanish online banking) ─────────────────────────────

const WEB_DESC_X = 100;
const WEB_DEPOSIT_MAX_X = 420;

function parseWebExport(lines: TextLine[]): WellsFargoStatement {
  const bb: Record<string, BoundingBox> = {};

  // ── Account type ──
  let accountType = "";
  for (const line of lines) {
    if (line.page > 1) break;
    const text = line.fullText.trim();
    if (/^(BUSINESS\s+)?CHECKING|SAVINGS|MONEY\s*MARKET/i.test(text) && !/page/i.test(text)) {
      accountType = text;
      bb.accountType = toBBox(line.segments[0], line);
      break;
    }
  }

  // ── Account number (masked: "...1797") ──
  let accountNumber = "";
  for (const line of lines) {
    if (line.page > 1) break;
    for (const seg of line.segments) {
      const m = seg.text.match(/^\.{2,3}(\d{4})$/);
      if (m) {
        accountNumber = seg.text;
        bb.accountNumber = toBBox(seg, line);
        break;
      }
    }
    if (accountNumber) break;
  }

  // ── Ending balance + date from "Saldo cobrado final al MM/DD/YY" ──
  let endingBalance = 0;
  let balanceDate: DateString = null;
  for (const line of lines) {
    if (line.page > 1) break;
    const m = line.fullText.match(/Saldo cobrado final al\s+(\d{1,2}\/\d{1,2}\/\d{2})/i);
    if (m) {
      balanceDate = webDateToISO(m[1]);
      const amtSeg = line.segments.find((s) => s.x > 400);
      if (amtSeg) {
        endingBalance = parseCurrency(amtSeg.text) ?? 0;
        bb.endingBalance = toBBox(amtSeg, line);
      }
      break;
    }
  }

  // ── Totals from "Totales" line ──
  let totalDeposits = 0;
  let totalWithdrawals = 0;
  for (const line of lines) {
    if (!/^Totales\b/i.test(line.fullText)) continue;
    const amounts = line.segments
      .filter((s) => s.x > 100)
      .map((s) => ({ val: parseCurrency(s.text), seg: s, line }))
      .filter((a) => a.val !== null);
    if (amounts.length >= 2) {
      totalDeposits = amounts[0].val!;
      bb.totalDeposits = toBBox(amounts[0].seg, line);
      totalWithdrawals = amounts[1].val!;
      bb.totalWithdrawals = toBBox(amounts[1].seg, line);
      break; // same totals on every page, take the first
    }
  }

  // ── Transactions ──
  const transactions = parseWebTransactions(lines);

  // ── Derive statement period from transaction dates ──
  const txDates = transactions
    .map((t) => t.date)
    .filter((d): d is string => d !== null)
    .sort();
  const periodFrom = txDates.length > 0 ? txDates[txDates.length - 1] : null; // most recent last chronologically (list is reverse-chrono)
  const periodTo = txDates.length > 0 ? txDates[0] : null;
  // Dates are in reverse-chrono order in the PDF, so first tx date = latest, last = earliest
  const earliest = txDates.length > 0 ? txDates[0] : null;
  const latest = txDates.length > 0 ? txDates[txDates.length - 1] : null;

  return {
    accountHolder: { name: "", address: "", boundingBoxes: {} },
    accountNumber,
    accountType,
    statementDate: balanceDate,
    statementPeriod: { from: earliest, to: latest },
    summary: {
      beginningBalance: 0,
      depositsCredits: totalDeposits,
      withdrawalsDebits: totalWithdrawals,
      endingBalance,
      boundingBoxes: bb,
    },
    totalDeposits,
    totalWithdrawals,
    transactions,
    boundingBoxes: bb,
  };
}

function parseWebTransactions(lines: TextLine[]): Transaction[] {
  const transactions: Transaction[] = [];
  let inTransactions = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = line.fullText.trim();

    // Start of transaction area
    if (/^Transacciones\s+(pendientes|registradas|autorizadas)/i.test(text)) {
      inTransactions = true;
      continue;
    }

    // Skip non-transaction content
    if (/^Fecha\s+Descripci[oó]n/i.test(text)) continue;
    if (/^Totales\b/i.test(text)) continue;
    if (/^https?:\/\//i.test(text)) continue;
    if (/^\d{1,2}\/\d{1,2}\/\d{2},\s+\d{1,2}:\d{2}/i.test(text)) continue; // page header timestamp
    if (/^Detalle de la cuenta/i.test(text)) continue;
    if (/^(Primera|Anterior|Siguiente)$/i.test(text)) continue;
    if (/^Nota:/i.test(text)) continue;
    if (/d[ée]bito podr[ií]an/i.test(text)) continue;

    if (!inTransactions) continue;

    const firstSeg = line.segments[0];
    if (!firstSeg) continue;

    // Transaction line: starts with MM/DD/YY date
    const dateMatch = firstSeg.text.trim().match(/^(\d{2}\/\d{2}\/\d{2})$/);
    if (dateMatch && firstSeg.x < WEB_DESC_X) {
      const txBb: Record<string, BoundingBox> = {};
      const date = webDateToISO(dateMatch[1]);
      txBb.date = toBBox(firstSeg, line);

      // Description: segments between date and amount columns
      const descSegs = line.segments.filter((s) => s.x >= WEB_DESC_X && s.x < 300);
      const description = descSegs.map((s) => s.text.trim()).join(" ");
      if (descSegs.length > 0) txBb.description = toBBox(descSegs[0], line);

      // Amount: rightmost segment with a dollar value
      const amtSegs = line.segments.filter((s) => s.x >= 300);
      let depositsCredits: number | null = null;
      let withdrawalsDebits: number | null = null;

      if (amtSegs.length > 0) {
        const amtSeg = amtSegs[amtSegs.length - 1];
        const val = parseCurrency(amtSeg.text);
        if (val !== null) {
          // Determine column by x position
          if (amtSeg.x < WEB_DEPOSIT_MAX_X) {
            depositsCredits = val;
            txBb.depositsCredits = toBBox(amtSeg, line);
          } else {
            withdrawalsDebits = val;
            txBb.withdrawalsDebits = toBBox(amtSeg, line);
          }
        }
      }

      transactions.push({
        date,
        checkNumber: "",
        description,
        depositsCredits,
        withdrawalsDebits,
        endingDailyBalance: null,
        boundingBoxes: txBb,
      });
    } else if (transactions.length > 0 && firstSeg.x >= WEB_DESC_X) {
      // Continuation line
      const descText = line.segments
        .filter((s) => s.x < 300)
        .map((s) => s.text.trim())
        .join(" ");
      if (descText) {
        transactions[transactions.length - 1].description += " " + descText;
      }
    }
  }

  return transactions;
}

function webDateToISO(dateStr: string): DateString {
  const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (m) {
    const yy = parseInt(m[3], 10);
    const fullYear = yy >= 80 ? `19${m[3]}` : `20${m[3]}`;
    return `${fullYear}-${m[1]}-${m[2]}`;
  }
  return null;
}
