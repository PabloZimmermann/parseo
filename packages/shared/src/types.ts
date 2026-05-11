// ── Bounding box ─────────────────────────────────────────────────────────────

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  pageNumber: number;
}

export function toBBox(seg: TextSegment, line: TextLine): BoundingBox {
  return {
    x: seg.x,
    y: line.y,
    width: seg.width,
    height: seg.height,
    pageNumber: line.page,
  };
}

// ── Shared primitives ─────────────────────────────────────────────────────────

/** ISO partial date string (e.g. "2024-02-04", "2024-02", "2024") or null */
export type DateString = string | null;

export interface DateRange {
  from: DateString;
  to: DateString;
}

// ── Extracted text primitives ──────────────────────────────────────────────────

export interface TextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
  page: number;
}

export interface TextSegment {
  text: string;
  x: number;
  width: number;
  height: number;
}

export interface TextLine {
  segments: TextSegment[];
  y: number;
  page: number;
  fullText: string;
}
