# Parseo

Monorepo of document parsers for underwriting: credit reports, background checks, and (future) bank statements and appraisal reports.

## Structure

```
packages/
  shared/             → @parseo/shared        (PDF extraction, errors, utils)
  credit-reports/     → @parseo/credit-reports (xactus, pcb, creditxpert + router)
  background-checks/  → @parseo/background-checks (smartlinx)
```

- npm workspaces at root — `npm install` links everything
- TypeScript project references — `npm run build` (`tsc --build`) compiles in dependency order
- Each package builds to `dist/` with declarations

## Dependencies

`credit-reports` and `background-checks` both depend on `@parseo/shared`. Shared owns PDF text extraction (`pdfjs-dist`), error classes, and parsing utilities.

## Imports

Cross-package imports use the package name, not relative paths:
```ts
import { extractLines, UnrecognizedFormatError } from "@parseo/shared";
```
Within-package imports stay relative (`./utils.js`, `../types.js`).

## Adding a new package

1. Create `packages/<name>/` with `src/`, `package.json` (`@parseo/<name>`), and `tsconfig.json`
2. Add `@parseo/shared` as a dependency if needed
3. Add a reference in root `tsconfig.json`

## CLI files

`**/cli.ts` files are dev-only tools (run with `tsx`). They're included in the build but not intended for consumers.
