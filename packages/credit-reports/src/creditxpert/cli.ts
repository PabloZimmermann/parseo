import { parseCreditXpertReport } from "./parser.js";
import * as fs from "fs";
import * as path from "path";
import { resolvePathFromArgs } from "@parseo/shared";

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: tsx credit-reports/creditxpert/cli.ts <pdf-path-or-directory>");
    process.exit(1);
  }

  const target = resolvePathFromArgs(args);
  const stat = fs.statSync(target);

  if (stat.isDirectory()) {
    // Parse all PDFs in the directory
    const files = fs
      .readdirSync(target)
      .filter((f) => f.toLowerCase().endsWith(".pdf"))
      .sort();

    for (const file of files) {
      const pdfPath = path.join(target, file);
      try {
        const report = await parseCreditXpertReport(fs.readFileSync(pdfPath));
        console.log(`\n── ${file} ──`);
        console.log(JSON.stringify(report, null, 2));
      } catch (err: any) {
        console.error(`\nFAIL ${file}: ${err.message}`);
      }
    }
  } else {
    // Parse a single PDF
    const report = await parseCreditXpertReport(fs.readFileSync(target));
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
