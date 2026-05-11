/**
 * Checkbox extraction from PDF vector graphics.
 *
 * In flattened TOTAL-generated PDFs, checkbox marks are rendered as
 * constructPath operations (small ~8.4×8.4 pt shapes). An unchecked
 * checkbox produces 1 path (the empty square outline). A checked
 * checkbox produces 5 paths (square outline + 4 X-mark line segments).
 *
 * We exploit this by counting how many path shapes fall at each
 * position — ≥ 3 means checked.
 */

import { OPS, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

type M = [number, number, number, number, number, number];

function multiply(a: M, b: M): M {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function applyM(m: M, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export interface CheckedPosition {
  /** x of the checkbox square (left edge) */
  x: number;
  /** y in top-down text coordinates (matches TextLine.y) */
  y: number;
}

/**
 * Extract all checked checkbox positions from a given PDF page.
 *
 * @returns Array of {x, y} positions where a checkbox is checked,
 *          in the same coordinate space as extracted TextLine objects.
 */
export async function extractCheckedBoxes(
  buffer: Buffer,
  pageNum: number,
): Promise<CheckedPosition[]> {
  const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const pdf = await getDocument({ data: uint8, useSystemFonts: true }).promise;
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  const pageHeight = viewport.height;

  const ops = await page.getOperatorList();
  const opsNames: Record<number, string> = {};
  for (const [name, val] of Object.entries(OPS)) {
    opsNames[val as number] = name;
  }

  // Track current transformation matrix with save/restore stack
  let ctm: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];

  // Collect all small (~8×8 pt) path shapes and their page coordinates
  const shapes: { x: number; y: number }[] = [];

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    const name = opsNames[fn];

    if (name === "save") {
      stack.push([...ctm] as M);
      continue;
    }
    if (name === "restore") {
      ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
      continue;
    }
    if (name === "transform") {
      ctm = multiply(ctm, args as M);
      continue;
    }

    if (name === "constructPath") {
      const [opcodes, pathArgs] = args;
      let ai = 0;
      const points: [number, number][] = [];

      for (const op of opcodes) {
        if (op === 13 /* moveTo */ || op === 14 /* lineTo */) {
          const px = pathArgs[ai++];
          const py = pathArgs[ai++];
          points.push(applyM(ctm, px, py));
        } else if (op === 19 /* rectangle */) {
          const rx = pathArgs[ai++], ry = pathArgs[ai++];
          const rw = pathArgs[ai++], rh = pathArgs[ai++];
          points.push(applyM(ctm, rx, ry));
          points.push(applyM(ctm, rx + rw, ry + rh));
        } else if (op === 18 /* closePath */) {
          // no args
        }
      }

      if (points.length >= 2) {
        const xs = points.map((p) => p[0]);
        const ys = points.map((p) => p[1]);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const w = maxX - minX;
        const h = maxY - minY;

        // Checkbox squares are ~8.4×8.4 pt; allow 6-11 range
        if (w >= 6 && w <= 11 && h >= 6 && h <= 11) {
          // Convert from PDF bottom-up to top-down text coordinates
          const textY = pageHeight - maxY;
          shapes.push({ x: Math.round(minX * 10) / 10, y: Math.round(textY * 10) / 10 });
        }
      }
    }
  }

  // Group shapes by position (within 3pt tolerance)
  const groups = new Map<string, number>();
  for (const s of shapes) {
    // Round to nearest 2pt grid to group nearby shapes
    const key = `${Math.round(s.x / 2) * 2},${Math.round(s.y / 2) * 2}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }

  // Checked checkboxes have >= 3 shapes at the same position
  const checked: CheckedPosition[] = [];
  for (const [key, count] of groups) {
    if (count >= 3) {
      const [x, y] = key.split(",").map(Number);
      checked.push({ x, y });
    }
  }

  return checked;
}

/**
 * Given a list of checked positions and a set of checkbox options
 * at known x-positions on a given text-y row, return which option is checked.
 *
 * The checkbox square is rendered ~7pt above the text label (lower y value
 * in top-down coordinates) and ~12pt to its left. Since rows are only
 * ~11pt apart, we use a directional y-match: the checkbox must be above
 * the text line (yDiff in [2, 12]) to avoid cross-row false positives.
 *
 * @param checked - Array of checked checkbox positions
 * @param textY - The y-coordinate of the text row (from TextLine.y)
 * @param options - Map of checkbox x-position to option label
 * @param xTolerance - x-axis matching tolerance in points (default 6)
 */
export function resolveCheckbox(
  checked: CheckedPosition[],
  textY: number,
  options: { x: number; label: string }[],
  xTolerance = 6,
): string {
  for (const opt of options) {
    // The checkbox square sits ~12pt to the left of the label text
    const checkboxX = opt.x - 12.3;
    const match = checked.find((c) => {
      const yDiff = textY - c.y; // positive when checkbox is above text
      return Math.abs(c.x - checkboxX) < xTolerance && yDiff >= 2 && yDiff <= 12;
    });
    if (match) return opt.label;
  }
  return "";
}
