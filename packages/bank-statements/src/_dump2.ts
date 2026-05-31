import { extractLines } from "@parseo/shared";
import { readFileSync } from "fs";
async function main() {
  const lines = await extractLines(readFileSync(process.argv[2]));
  for (const line of lines) {
    console.log(`p${line.page} y=${line.y.toFixed(0)} | ${line.fullText}`);
  }
}
main();
