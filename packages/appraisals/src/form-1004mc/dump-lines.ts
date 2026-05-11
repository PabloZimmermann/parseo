import { extractLines } from "@parseo/shared";
import { readFile } from "node:fs/promises";

async function main() {
  const buf = await readFile(process.argv[2]!);
  const lines = await extractLines(buf);

  // Find which page has the URAR form
  for (const l of lines) {
    if (/Uniform Residential|Form 1004/i.test(l.fullText)) {
      console.log(`URAR on page=${l.page} y=${l.y.toFixed(1)} "${l.fullText.substring(0, 100)}"`);
      break;
    }
  }

  // Find Occupant line and dump segments
  for (const l of lines) {
    if (/^Occupant/i.test(l.fullText)) {
      console.log(`\nOccupant: page=${l.page} y=${l.y.toFixed(1)} "${l.fullText}"`);
      for (const seg of l.segments) {
        console.log(`  x=${seg.x.toFixed(1)} w=${seg.width.toFixed(1)} text="${seg.text}"`);
      }
      break;
    }
  }

  // Show unique pages
  const pages = new Set(lines.map((l) => l.page));
  console.log("\nTotal pages:", pages.size, "Pages:", [...pages].join(","));
}

main();
