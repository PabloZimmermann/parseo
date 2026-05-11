import { parseTDBankStatement } from "./parser.js";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { resolvePathFromArgs } from "@parseo/shared";

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: npx tsx bank-statements/td-bank/cli.ts <pdf-path> [--output <json-path>]");
    process.exit(1);
  }

  const pdfPath = resolvePathFromArgs(args);
  const outputIdx = args.indexOf("--output");
  const outputPath = outputIdx >= 0 ? resolve(args[outputIdx + 1]) : null;
  const buffer = readFileSync(pdfPath);

  console.error(`Parsing: ${pdfPath}`);

  const report = await parseTDBankStatement(buffer);
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
