import { extractLines, toBBox } from "@parseo/shared";
import { UnrecognizedFormatError, MissingSectionError } from "@parseo/shared";
import type { TextLine } from "@parseo/shared";
import type { BoundingBox } from "@parseo/shared";
import type { BureauScore, CreditXpertReport, CreditXpertSettings } from "./types.js";

const BUREAUS = ["TransUnion", "Experian", "Equifax"] as const;

/**
 * Parse a CreditXpert score-only PDF into structured JSON.
 *
 * Two known layouts:
 *   Format A (common):  "Applicant NAME  Co-applicant [CO_NAME]"
 *                        score lines interleaved with bureau labels
 *   Format B (older):    "Applicant: NAME", column-based bureau headers
 */
export function parseCreditXpertFromLines(
  lines: TextLine[]
): CreditXpertReport {
  // Format fingerprint check
  const head = lines.slice(0, 20).map((l) => l.fullText).join("\n");
  if (!/creditxpert/i.test(head)) {
    throw new UnrecognizedFormatError(
      "CreditXpert",
      "first 20 lines do not contain a CreditXpert signature"
    );
  }

  const texts = lines.map((l) => l.fullText);

  // Only consider the CreditXpert summary section (page 1, before disclaimer).
  // Find the end boundary: "Settings Used" or "Copyright".
  let endIdx = texts.length;
  for (let i = 0; i < texts.length; i++) {
    if (/^Settings\s+Used:/i.test(texts[i].trim())) {
      endIdx = i + 1; // include the settings line
      break;
    }
    if (/^Copyright/i.test(texts[i].trim())) {
      endIdx = i;
      break;
    }
  }
  const summaryTexts = texts.slice(0, endIdx);
  const summaryLines = lines.slice(0, endIdx);

  // Detect format
  const report = isFormatB(summaryTexts)
    ? parseFormatB(summaryTexts, summaryLines)
    : parseFormatA(summaryTexts, summaryLines);

  // Required section validation: at least one score with a non-null currentScore
  const hasScore = report.scores.some((s) => s.currentScore !== null);
  if (!hasScore) {
    throw new MissingSectionError(
      "CreditXpert",
      "scores (no entry with a non-null currentScore)"
    );
  }

  return report;
}

export async function parseCreditXpertReport(
  buffer: Buffer
): Promise<CreditXpertReport> {
  const lines = await extractLines(buffer);
  return parseCreditXpertFromLines(lines);
}

// ── Format detection ───────────────────────────────────────────────────────

function isFormatB(texts: string[]): boolean {
  // Format B has "Bureau Scores" row with numbers and column-based layout.
  // Format A has the "Applicant NAME  Co-applicant" header.
  const hasBureauScoresRow = texts.some((t) => /bureau\s*scores/i.test(t));
  const hasFormatAHeader = texts.some((t) =>
    /^Applicant\s+[A-Z].*\s{2,}Co-applicant/i.test(t.trim())
  );
  return hasBureauScoresRow && !hasFormatAHeader;
}

// ── Format A — the common layout ──────────────────────────────────────────

function parseFormatA(texts: string[], lines: TextLine[]): CreditXpertReport {
  const applicant = parseApplicantLineA(texts, lines);
  const scores = parseScoresA(texts, lines);
  const settings = parseSettings(texts, lines);

  const bb: Record<string, BoundingBox> = {
    ...applicant.boundingBoxes,
  };

  return {
    applicantName: applicant.applicantName,
    coApplicantName: applicant.coApplicantName,
    scores,
    settings,
    boundingBoxes: bb,
  };
}

function parseApplicantLineA(texts: string[], lines: TextLine[]): {
  applicantName: string;
  coApplicantName: string;
  boundingBoxes: Record<string, BoundingBox>;
} {
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    // "Applicant ALEX KAUFFMAN  Co-applicant"
    // "Applicant ALEX KAUFFMAN  Co-applicant JANE DOE"
    const m = t.match(
      /Applicant\s+(.+?)\s{2,}Co-applicant\s*(.*)/i
    );
    if (m) {
      const bb: Record<string, BoundingBox> = {};
      if (lines[i]?.segments[0]) {
        bb.applicantName = toBBox(lines[i].segments[0], lines[i]);
      }
      if (m[2].trim() && lines[i]?.segments[0]) {
        // co-applicant name is on the same line; use last segment if available
        const segs = lines[i].segments;
        bb.coApplicantName = toBBox(segs[segs.length - 1], lines[i]);
      }
      return {
        applicantName: titleCase(m[1].trim()),
        coApplicantName: titleCase(m[2].trim()),
        boundingBoxes: bb,
      };
    }
  }
  return { applicantName: "", coApplicantName: "", boundingBoxes: {} };
}

function parseScoresA(texts: string[], lines: TextLine[]): BureauScore[] {
  // Layout repeats for each bureau:
  //   line i:   "787  802 15"    (currentScore  potentialScore  [improvement])
  //   line i+1: "TransUnion  Not ordered"   or "TransUnion"
  //   line i+2: "Current score  Potential score"
  //
  // Sometimes when current == potential there's no improvement number.

  const scores: BureauScore[] = [];

  for (let i = 0; i < texts.length; i++) {
    const bureauMatch = matchBureauLine(texts[i]);
    if (!bureauMatch) continue;

    const bureau = bureauMatch.bureau;
    const notOrdered = /not\s*ordered/i.test(texts[i]);

    // The score line is ABOVE the bureau line
    const scoreLine = i > 0 ? texts[i - 1] : "";
    const parsed = parseScoreLine(scoreLine);

    const bb: Record<string, BoundingBox> = {};
    // Bureau name bbox from the bureau line
    if (lines[i]?.segments[0]) {
      bb.bureau = toBBox(lines[i].segments[0], lines[i]);
    }
    // Score values bbox from the line above
    if (parsed && i > 0 && lines[i - 1]?.segments[0]) {
      const scoreSegs = lines[i - 1].segments;
      bb.currentScore = toBBox(scoreSegs[0], lines[i - 1]);
      if (scoreSegs.length >= 2) {
        bb.potentialScore = toBBox(scoreSegs[1], lines[i - 1]);
      }
      if (parsed.improvement !== null && scoreSegs.length >= 3) {
        bb.scoreImprovement = toBBox(scoreSegs[2], lines[i - 1]);
      }
    }

    scores.push({
      bureau,
      currentScore: parsed?.currentScore ?? null,
      potentialScore: parsed?.potentialScore ?? null,
      scoreImprovement: parsed?.improvement ?? null,
      ordered: parsed !== null,
      boundingBoxes: bb,
    });
  }

  return scores;
}

function matchBureauLine(
  text: string
): { bureau: string } | null {
  const t = text.trim();
  for (const b of BUREAUS) {
    if (t.startsWith(b)) return { bureau: b };
  }
  return null;
}

function parseScoreLine(
  text: string
): { currentScore: number; potentialScore: number; improvement: number | null } | null {
  const t = text.trim();
  // Expect "787  802 15" or "813  813" (no improvement)
  const nums = t.split(/\s+/).map(Number).filter((n) => !isNaN(n) && n > 0);
  if (nums.length >= 2) {
    const currentScore = nums[0];
    const potentialScore = nums[1];
    const improvement = nums.length >= 3 ? nums[2] : null;
    // Sanity: scores should be in credit score range
    if (currentScore >= 300 && currentScore <= 900 && potentialScore >= 300 && potentialScore <= 900) {
      return { currentScore, potentialScore, improvement };
    }
  }
  return null;
}

// ── Format B — older column-based layout ──────────────────────────────────

function parseFormatB(texts: string[], lines: TextLine[]): CreditXpertReport {
  let applicantName = "";
  let coApplicantName = "";
  const reportBB: Record<string, BoundingBox> = {};

  // Find applicant
  for (let i = 0; i < texts.length; i++) {
    const m = texts[i].match(/^Applicant:\s*(.+)/i);
    if (m) {
      applicantName = titleCase(m[1].trim());
      if (lines[i]?.segments[0]) {
        reportBB.applicantName = toBBox(lines[i].segments[0], lines[i]);
      }
      break;
    }
  }

  // Find co-applicant
  for (let i = 0; i < texts.length; i++) {
    const m = texts[i].match(/^Co-applicant:\s*(.+)/i);
    if (m) {
      coApplicantName = titleCase(m[1].trim());
      if (lines[i]?.segments[0]) {
        reportBB.coApplicantName = toBBox(lines[i].segments[0], lines[i]);
      }
      break;
    }
  }

  // Determine bureau order from header line like "Experian  TransUnion  Equifax"
  let bureauOrder: string[] = [];
  for (const t of texts) {
    const found = BUREAUS.filter((b) => t.includes(b));
    if (found.length >= 2) {
      // Preserve order as they appear in the text
      bureauOrder = found.sort(
        (a, b) => t.indexOf(a) - t.indexOf(b)
      );
      break;
    }
  }
  if (bureauOrder.length === 0) bureauOrder = [...BUREAUS];

  // Find "Bureau Scores" line — numbers follow or are on the same line
  let bureauScores: (number | null)[] = [null, null, null];
  let improvements: (number | null)[] = [null, null, null];
  let bureauScoresLineIdx = -1;
  let improvementsLineIdx = -1;

  for (let i = 0; i < texts.length; i++) {
    if (/bureau\s*scores/i.test(texts[i])) {
      const nums = extractNumbers(texts[i]);
      if (nums.length >= bureauOrder.length) {
        bureauScores = nums.slice(0, bureauOrder.length);
        bureauScoresLineIdx = i;
      }
    }
    if (/potential\s*score/i.test(texts[i])) {
      // The improvement line often follows: "+42  0  +19" or similar
      // Check next line
      if (i + 1 < texts.length && /improvement/i.test(texts[i + 1])) {
        // Improvements are on the line between "Potential Score" and "Improvement"
        // or on the same line as "Potential Score"
        const impNums = extractSignedNumbers(texts[i + 1]);
        // Also check a line that's just numbers between these
        if (impNums.length === 0) {
          // Try the text between
        }
      }
    }
  }

  // Try to find the improvement numbers: look for lines with +N patterns
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    const plusMatches = t.match(/[+]?\d+/g);
    if (plusMatches && plusMatches.length >= bureauOrder.length) {
      const hasPlus = t.includes("+");
      if (hasPlus) {
        improvements = plusMatches
          .slice(0, bureauOrder.length)
          .map((s) => parseInt(s.replace("+", ""), 10));
        improvementsLineIdx = i;
        break;
      }
    }
  }

  const scores: BureauScore[] = bureauOrder.map((bureau, idx) => {
    const current = bureauScores[idx];
    const imp = improvements[idx];
    const potential =
      current !== null && imp !== null ? current + imp : null;

    const bb: Record<string, BoundingBox> = {};
    // Bureau score bbox from the bureau scores line
    if (bureauScoresLineIdx >= 0 && lines[bureauScoresLineIdx]?.segments[idx]) {
      bb.bureau = toBBox(lines[bureauScoresLineIdx].segments[0], lines[bureauScoresLineIdx]);
      bb.currentScore = toBBox(lines[bureauScoresLineIdx].segments[idx], lines[bureauScoresLineIdx]);
    }
    // Improvement bbox
    if (imp !== null && imp > 0 && improvementsLineIdx >= 0 && lines[improvementsLineIdx]?.segments[idx]) {
      bb.scoreImprovement = toBBox(lines[improvementsLineIdx].segments[idx], lines[improvementsLineIdx]);
    }

    return {
      bureau,
      currentScore: current,
      potentialScore: potential,
      scoreImprovement: imp !== null && imp > 0 ? imp : null,
      ordered: current !== null,
      boundingBoxes: bb,
    };
  });

  const settings = parseSettings(texts, lines);

  return { applicantName, coApplicantName, scores, settings, boundingBoxes: reportBB };
}

function extractNumbers(text: string): (number | null)[] {
  const matches = text.match(/\d+/g);
  if (!matches) return [];
  return matches.map((s) => parseInt(s, 10));
}

function extractSignedNumbers(text: string): number[] {
  const matches = text.match(/[+-]?\d+/g);
  if (!matches) return [];
  return matches.map((s) => parseInt(s, 10));
}

// ── Shared helpers ─────────────────────────────────────────────────────────

function parseSettings(texts: string[], lines: TextLine[]): CreditXpertSettings {
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    const m = t.match(
      /Available\s+cash:\s*([\d,]+)\s*\|\s*Timeframe:\s*(.+)/i
    );
    if (m) {
      const bb: Record<string, BoundingBox> = {};
      if (lines[i]?.segments[0]) {
        bb.availableCash = toBBox(lines[i].segments[0], lines[i]);
      }
      // Timeframe — try last segment on the line
      const segs = lines[i]?.segments;
      if (segs && segs.length > 1) {
        bb.timeframe = toBBox(segs[segs.length - 1], lines[i]);
      }
      return {
        availableCash: parseInt(m[1].replace(/,/g, ""), 10),
        timeframe: m[2].trim(),
        boundingBoxes: bb,
      };
    }
  }
  return { availableCash: null, timeframe: "", boundingBoxes: {} };
}

function titleCase(s: string): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
