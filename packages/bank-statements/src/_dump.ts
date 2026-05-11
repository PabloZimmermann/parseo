import { extractLines } from "@parseo/shared";
import { readFileSync } from "fs";

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath) { console.error("Usage: tsx _dump.ts <pdf>"); process.exit(1); }
  const lines = await extractLines(readFileSync(pdfPath));
  for (const [i, line] of lines.entries()) {
    if (line.page > 4) break;
    console.log(`--- LINE ${i} (page=${line.page} y=${line.y}) ---`);
    console.log(`  fullText: ${JSON.stringify(line.fullText)}`);
    for (const seg of line.segments) {
      console.log(`  seg x=${seg.x} w=${seg.width}: ${JSON.stringify(seg.text)}`);
    }
  }
}
main();
