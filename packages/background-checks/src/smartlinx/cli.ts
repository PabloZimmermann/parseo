import { parseSmartLinxReport, debugExtract } from "./parser.js";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { resolvePathFromArgs } from "@parseo/shared";

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: npx tsx background-checks/smartlinx/cli.ts <pdf-path> [--output <json-path>] [--debug]");
    process.exit(1);
  }

  const pdfPath = resolvePathFromArgs(args);
  const outputIdx = args.indexOf("--output");
  const outputPath = outputIdx >= 0 ? resolve(args[outputIdx + 1]) : null;
  const debugMode = args.includes("--debug");
  const buffer = readFileSync(pdfPath);

  console.error(`Parsing: ${pdfPath}`);

  if (debugMode) {
    const { lines, sections } = await debugExtract(buffer);
    console.error(`Extracted ${lines.length} lines across ${sections.length} sections`);
    console.error("Sections found:");
    for (const s of sections) {
      console.error(`  - ${s.name} (${s.lines.length} lines)`);
    }

    if (outputPath) {
      writeFileSync(outputPath, JSON.stringify({ sections: sections.map(s => ({ name: s.name, lineCount: s.lines.length, lines: s.lines.map(l => l.fullText) })) }, null, 2));
      console.error(`Debug output written to: ${outputPath}`);
    }
    return;
  }

  const report = await parseSmartLinxReport(buffer);

  const json = JSON.stringify(report, null, 2);

  if (outputPath) {
    writeFileSync(outputPath, json);
    console.error(`Output written to: ${outputPath}`);
  } else {
    console.log(json);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
