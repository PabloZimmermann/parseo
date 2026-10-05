import { readFile } from "node:fs/promises";
import { parseForm1025 } from "./parser.js";

const file = process.argv[2];
if (!file) { console.error("Usage: tsx cli.ts <pdf-file>"); process.exit(1); }

const buf = await readFile(file);
const report = await parseForm1025(buf);
console.log(JSON.stringify(report, null, 2));
