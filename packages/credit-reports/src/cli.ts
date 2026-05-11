import { parseCreditReportForTextract } from "./textract.js";
import { readFileSync } from "fs";
import { resolvePathFromArgs } from "@parseo/shared";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: npx tsx packages/credit-reports/src/cli.ts <pdf-path>");
    process.exit(1);
  }

  const pdfPath = resolvePathFromArgs(args);
  const buffer = readFileSync(pdfPath);
  const result = await parseCreditReportForTextract(buffer);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
