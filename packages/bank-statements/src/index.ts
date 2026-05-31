import { parseWellsFargoStatement, parseWellsFargoFromLines } from "./wells-fargo/index.js";
import { parseTDBankStatement, parseTDBankFromLines } from "./td-bank/index.js";
import { parseChaseStatement, parseChaseFromLines } from "./chase/index.js";
import { parseBankOfAmericaStatement, parseBankOfAmericaFromLines } from "./bank-of-america/index.js";
import { parseNavyFederalStatement, parseNavyFederalFromLines } from "./navy-federal/index.js";
import { parseThirdFederalStatement, parseThirdFederalFromLines } from "./third-federal/index.js";
import { parseCitibankStatement, parseCitibankFromLines } from "./citibank/index.js";
import { parseRelayStatement, parseRelayFromLines } from "./relay/index.js";
import { parseGroveBankStatement, parseGroveBankFromLines } from "./grove-bank/index.js";
import { parseCapitalOneStatement, parseCapitalOneFromLines } from "./capital-one/index.js";
import { parseTruistStatement, parseTruistFromLines } from "./truist/index.js";
import { parsePNCStatement, parsePNCFromLines } from "./pnc/index.js";
import { parseDiscoverStatement, parseDiscoverFromLines } from "./discover/index.js";
import { parseSynovusStatement, parseSynovusFromLines } from "./synovus/index.js";
import { parseSpaceCoastStatement, parseSpaceCoastFromLines } from "./space-coast/index.js";
export const wellsFargo = parseWellsFargoStatement;
export const tdBank = parseTDBankStatement;
export const chase = parseChaseStatement;
export const bankOfAmerica = parseBankOfAmericaStatement;
export const navyFederal = parseNavyFederalStatement;
export const thirdFederal = parseThirdFederalStatement;
export const citibank = parseCitibankStatement;
export const relay = parseRelayStatement;
export const groveBank = parseGroveBankStatement;
export const capitalOne = parseCapitalOneStatement;
export const truist = parseTruistStatement;
export const pnc = parsePNCStatement;
export const discover = parseDiscoverStatement;
export const synovus = parseSynovusStatement;
export const spaceCoast = parseSpaceCoastStatement;
export {
  parseWellsFargoFromLines,
  parseTDBankFromLines,
  parseChaseFromLines,
  parseBankOfAmericaFromLines,
  parseNavyFederalFromLines,
  parseThirdFederalFromLines,
  parseCitibankFromLines,
  parseRelayFromLines,
  parseGroveBankFromLines,
  parseCapitalOneFromLines,
  parseTruistFromLines,
  parsePNCFromLines,
  parseDiscoverFromLines,
  parseSynovusFromLines,
  parseSpaceCoastFromLines,
};
export type { WellsFargoStatement } from "./wells-fargo/index.js";
export type { TDBankStatement } from "./td-bank/index.js";
export type { ChaseStatement } from "./chase/index.js";
export type { BankOfAmericaStatement } from "./bank-of-america/index.js";
export type { NavyFederalStatement } from "./navy-federal/index.js";
export type { ThirdFederalStatement } from "./third-federal/index.js";
export type { CitibankStatement } from "./citibank/index.js";
export type { RelayStatement } from "./relay/index.js";
export type { GroveBankStatement } from "./grove-bank/index.js";
export type { CapitalOneStatement } from "./capital-one/index.js";
export type { TruistStatement } from "./truist/index.js";
export type { PNCStatement } from "./pnc/index.js";
export type { DiscoverStatement } from "./discover/index.js";
export type { SynovusStatement } from "./synovus/index.js";
export type { SpaceCoastStatement } from "./space-coast/index.js";
