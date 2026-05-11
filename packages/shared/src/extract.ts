import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem as PDFTextItem } from "pdfjs-dist/types/src/display/api.js";
import { createRequire } from "module";
import { dirname, join } from "path";
import type { TextItem, TextLine, TextSegment } from "./types.js";
import { InvalidPDFError, ExtractionError } from "./errors.js";

const require = createRequire(import.meta.url);
const pdfjsDir = dirname(require.resolve("pdfjs-dist/package.json"));
const standardFontDataUrl = join(pdfjsDir, "standard_fonts") + "/";
const cMapUrl = join(pdfjsDir, "cmaps") + "/";

const LINE_Y_TOLERANCE = 3;
const COLUMN_GAP_THRESHOLD = 15;

export async function extractTextItems(
  buffer: Buffer
): Promise<TextItem[]> {
  if (!buffer || buffer.length === 0) {
    throw new InvalidPDFError("input buffer is empty");
  }

  if (buffer.length < 10 || buffer.subarray(0, 5).toString() !== "%PDF-") {
    throw new InvalidPDFError(
      "input does not start with a PDF header (%PDF-). Received " +
      `${buffer.length} bytes starting with "${buffer.subarray(0, 20).toString().replace(/[^\x20-\x7E]/g, "?")}"`
    );
  }

  let doc;
  try {
    doc = await getDocument({
      data: new Uint8Array(buffer),
      standardFontDataUrl,
      cMapUrl,
      cMapPacked: true,
    }).promise;
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (msg.includes("password") || msg.includes("encrypted")) {
      throw new InvalidPDFError("PDF is password-protected or encrypted", { cause: err });
    }
    throw new ExtractionError(msg, { cause: err });
  }

  const items: TextItem[] = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    let page;
    try {
      page = await doc.getPage(pageNum);
    } catch (err: any) {
      throw new ExtractionError(`failed to read page ${pageNum}: ${err?.message || err}`, { cause: err });
    }
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();

    for (const item of textContent.items) {
      const ti = item as PDFTextItem;
      if (!ti.str || ti.str.trim() === "") continue;

      const tx = ti.transform;
      const x = tx[4];
      const yFromBottom = tx[5];
      const y = viewport.height - yFromBottom;
      const fontSize = Math.abs(tx[3]);

      items.push({
        text: ti.str,
        x: Math.round(x * 100) / 100,
        y: Math.round(y * 100) / 100,
        width: Math.round((ti.width ?? 0) * 100) / 100,
        height: Math.round(fontSize * 100) / 100,
        fontName: ti.fontName ?? "",
        page: pageNum,
      });
    }
  }

  if (items.length === 0) {
    throw new ExtractionError(
      "PDF has no extractable text. It may be a scanned image — OCR is required."
    );
  }

  return items;
}

export function formLines(items: TextItem[]): TextLine[] {
  const sorted = [...items].sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    if (Math.abs(a.y - b.y) > LINE_Y_TOLERANCE) return a.y - b.y;
    return a.x - b.x;
  });

  const lines: TextLine[] = [];
  let currentLineItems: TextItem[] = [];
  let currentY = -Infinity;
  let currentPage = -1;

  for (const item of sorted) {
    if (
      item.page !== currentPage ||
      Math.abs(item.y - currentY) > LINE_Y_TOLERANCE
    ) {
      if (currentLineItems.length > 0) {
        lines.push(buildLine(currentLineItems, currentY, currentPage));
      }
      currentLineItems = [item];
      currentY = item.y;
      currentPage = item.page;
    } else {
      currentLineItems.push(item);
    }
  }
  if (currentLineItems.length > 0) {
    lines.push(buildLine(currentLineItems, currentY, currentPage));
  }

  return lines;
}

function buildLine(items: TextItem[], y: number, page: number): TextLine {
  const sortedByX = [...items].sort((a, b) => a.x - b.x);

  const segments: TextSegment[] = [];
  let currentSeg: TextSegment | null = null;

  for (const item of sortedByX) {
    if (currentSeg === null) {
      currentSeg = { text: item.text, x: item.x, width: item.width, height: item.height };
    } else {
      const gap = item.x - (currentSeg.x + currentSeg.width);
      if (gap > COLUMN_GAP_THRESHOLD) {
        segments.push(currentSeg);
        currentSeg = { text: item.text, x: item.x, width: item.width, height: item.height };
      } else {
        const needsSpace = gap > 1 && !currentSeg.text.endsWith(" ");
        currentSeg.text += (needsSpace ? " " : "") + item.text;
        currentSeg.width = item.x + item.width - currentSeg.x;
        currentSeg.height = Math.max(currentSeg.height, item.height);
      }
    }
  }
  if (currentSeg) segments.push(currentSeg);

  const fullText = segments.map((s) => s.text).join("  ");

  return { segments, y, page, fullText };
}

export function extractLines(buffer: Buffer): Promise<TextLine[]> {
  return extractTextItems(buffer).then(formLines);
}

/** A small filled rectangle found in the PDF graphics layer. */
export interface FilledRect {
  x: number;
  y: number; // top-relative
  width: number;
  height: number;
  page: number;
}

/**
 * Extract small filled rectangles from specific PDF pages.
 * Useful for detecting checked checkboxes in flattened PDF forms where
 * checkbox state is rendered as filled squares rather than form annotations.
 */
export async function extractFilledRects(
  buffer: Buffer,
  pages: number[],
  opts?: { minSize?: number; maxSize?: number },
): Promise<FilledRect[]> {
  const minSize = opts?.minSize ?? 3;
  const maxSize = opts?.maxSize ?? 15;

  const doc = await getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl,
    cMapUrl,
    cMapPacked: true,
  }).promise;

  const results: FilledRect[] = [];

  for (const pageNum of pages) {
    if (pageNum < 1 || pageNum > doc.numPages) continue;
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const opList = await page.getOperatorList();

    let currentTransform = [1, 0, 0, 1, 0, 0];
    const transformStack: number[][] = [];

    for (let i = 0; i < opList.fnArray.length; i++) {
      const op = opList.fnArray[i];
      const args = opList.argsArray[i];

      if (op === OPS.save) {
        transformStack.push([...currentTransform]);
      } else if (op === OPS.restore) {
        currentTransform = transformStack.pop() || [1, 0, 0, 1, 0, 0];
      } else if (op === OPS.transform) {
        const [a, b, c, d, e, f] = args;
        const [ca, cb, cc, cd, ce, cf] = currentTransform;
        currentTransform = [
          ca * a + cc * b, cb * a + cd * b,
          ca * c + cc * d, cb * c + cd * d,
          ca * e + cc * f + ce, cb * e + cd * f + cf,
        ];
      } else if (op === OPS.constructPath) {
        const subOps = args[0] as number[];
        const subArgs = args[1] as number[];
        let argIdx = 0;
        for (const subOp of subOps) {
          if (subOp === OPS.rectangle) {
            const rx = subArgs[argIdx], ry = subArgs[argIdx + 1];
            const rw = subArgs[argIdx + 2], rh = subArgs[argIdx + 3];
            const absW = Math.abs(rw), absH = Math.abs(rh);
            if (absW >= minSize && absW <= maxSize && absH >= minSize && absH <= maxSize) {
              const tx = currentTransform[0] * rx + currentTransform[2] * ry + currentTransform[4];
              const ty = currentTransform[1] * rx + currentTransform[3] * ry + currentTransform[5];
              results.push({
                x: Math.round(tx * 100) / 100,
                y: Math.round((viewport.height - ty) * 100) / 100,
                width: Math.round(absW * 100) / 100,
                height: Math.round(absH * 100) / 100,
                page: pageNum,
              });
            }
            argIdx += 4;
          } else if (subOp === OPS.moveTo || subOp === OPS.lineTo) {
            argIdx += 2;
          } else if (subOp === OPS.curveTo) {
            argIdx += 6;
          } else if (subOp === OPS.curveTo2 || subOp === OPS.curveTo3) {
            argIdx += 4;
          }
          // closePath has no args
        }
      }
    }
  }

  await doc.destroy();

  // Deduplicate rects at the same position (checkboxes often have outline + fill)
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = `${r.page}:${r.x.toFixed(0)}:${r.y.toFixed(0)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
