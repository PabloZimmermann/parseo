import { parseXactusCreditReport } from "./parser.js";
import { readFileSync } from "fs";
import { resolvePathFromArgs } from "@parseo/shared";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: tsx credit-reports/xactus/cli.ts <pdf-path>");
    process.exit(1);
  }

  const pdfPath = resolvePathFromArgs(args);
  const buffer = readFileSync(pdfPath);
  const report = await parseXactusCreditReport(buffer);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
