import { parsePCBReport } from "./parser.js";
import * as fs from "fs";
import * as path from "path";
import { resolvePathFromArgs } from "@parseo/shared";

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: tsx credit-reports/pcb/cli.ts <pdf-file-or-directory> [--json] [--test]");
    process.exit(1);
  }

  const target = resolvePathFromArgs(args);
  const jsonMode = args.includes("--json");
  const testMode = args.includes("--test");

  if (testMode) {
    await runTests(target);
    return;
  }

  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    const files = fs.readdirSync(target).filter((f) => f.endsWith(".pdf"));
    for (const file of files) {
      const filePath = path.join(target, file);
      console.log(`\n=== ${file} ===`);
      await parseAndPrint(filePath, jsonMode);
    }
  } else {
    await parseAndPrint(target, jsonMode);
  }
}

async function parseAndPrint(pdfPath: string, json: boolean) {
  const buffer = fs.readFileSync(pdfPath);
  const report = await parsePCBReport(buffer);
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printSummary(report);
  }
}

function printSummary(report: ReturnType<typeof import("./parser.js")["parsePCBReport"]> extends Promise<infer T> ? T : never) {
  const r = report;
  console.log(`  File #: ${r.header.fileNumber}`);
  console.log(`  Date Completed: ${r.header.dateCompleted}`);
  console.log(`  Applicant: ${r.applicant.name} (SSN: ${r.applicant.ssn})`);
  if (r.coApplicant) {
    console.log(`  Co-Applicant: ${r.coApplicant.name} (SSN: ${r.coApplicant.ssn})`);
  }
  console.log(`  Score Models: ${r.scoreModels.length}`);
  for (const sm of r.scoreModels) {
    console.log(`    ${sm.bureau}/${sm.modelName}: ${sm.score} (${sm.factors.length} factors)`);
  }
  console.log(`  Credit Bureau Errors: ${r.creditBureauErrors.length}`);
  console.log(`  Public Records: ${r.publicRecords.length}`);
  console.log(`  Derogatory Accounts: ${r.derogatoryAccounts.length}`);
  console.log(`  Accounts With Balance: ${r.accountsWithBalance.length}`);
  console.log(`  Accounts With No Balance: ${r.accountsWithNoBalance.length}`);
  console.log(`  Real Estate Accounts: ${r.realEstateAccounts.length}`);
  console.log(`  Inquiries: ${r.inquiries.length}`);

  // Show account summary
  const allAccounts = [
    ...r.derogatoryAccounts,
    ...r.accountsWithBalance,
    ...r.accountsWithNoBalance,
    ...r.realEstateAccounts,
  ];
  for (const a of allAccounts) {
    const bal = a.balance !== null ? `$${a.balance}` : "N/A";
    const trended = a.trended ? " [trended]" : "";
    console.log(`    ${a.ecoa}/${a.whose} ${a.creditor}: ${bal} - ${a.status}${trended}`);
  }
}

async function runTests(dir: string) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".pdf"));
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    try {
      const report = await parsePCBReport(fs.readFileSync(filePath));
      const errors: string[] = [];

      // Validate basic structure
      if (!report.header.fileNumber) errors.push("missing fileNumber");
      if (!report.header.dateCompleted) errors.push("missing dateCompleted");
      if (!report.applicant.name) errors.push("missing applicant name");
      if (!report.applicant.ssn) errors.push("missing applicant SSN");

      // Validate score models have scores
      for (const sm of report.scoreModels) {
        if (sm.score === null) errors.push(`score model ${sm.bureau} has null score`);
        if (!sm.bureau) errors.push("score model missing bureau");
      }

      // Validate accounts have creditor names
      const allAccounts = [
        ...report.derogatoryAccounts,
        ...report.accountsWithBalance,
        ...report.accountsWithNoBalance,
        ...report.realEstateAccounts,
      ];
      for (const a of allAccounts) {
        if (!a.creditor) errors.push("account missing creditor");
        if (!a.accountNumber) errors.push(`account ${a.creditor} missing accountNumber`);
      }

      if (errors.length > 0) {
        failed++;
        const msg = `FAIL ${file}: ${errors.join(", ")}`;
        failures.push(msg);
        console.log(msg);
      } else {
        passed++;
        console.log(
          `PASS ${file}: ${report.scoreModels.length} scores, ` +
          `${allAccounts.length} accounts, ` +
          `${report.inquiries.length} inquiries`
        );
      }
    } catch (err: any) {
      failed++;
      const msg = `FAIL ${file}: ${err.message}`;
      failures.push(msg);
      console.log(msg);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed out of ${files.length} files`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  ${f}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
