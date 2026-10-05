import { extractLines } from "@parseo/shared";
import { readFile } from "node:fs/promises";

async function main() {
  const buf = await readFile(process.argv[2]!);
  const lines = await extractLines(buf);

  const only = process.argv[3] ? parseInt(process.argv[3], 10) : null;

  const pages = new Set(lines.map((l) => l.page));
  console.log("Total pages:", pages.size, "Pages:", [...pages].join(","));

  for (const l of lines) {
    if (only !== null && l.page !== only) continue;
    const segs = l.segments
      .map((s) => `[x=${s.x.toFixed(0)} "${s.text}"]`)
      .join(" ");
    console.log(`p${l.page} y=${l.y.toFixed(0)} ${segs}`);
  }
}

main();
