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

## Version bumping / publishing

When bumping versions, **every** version reference in the monorepo must be updated. The full checklist:

1. **Root `package.json`** — `"version"` field
2. **Each `packages/*/package.json`** — `"version"` field
3. **`packages/core/package.json` dependencies** — `@parseo/*` dependency ranges must be compatible with the new version (use `^` caret ranges, not exact pins)
4. **Any other cross-package `@parseo/*` dependency** in any `packages/*/package.json`

Workspace resolution masks version mismatches locally — npm workspaces always resolve to the local copy regardless of the version string. A pinned or outdated dependency version will only break for external consumers installing from npm. Always verify that `packages/core/package.json` dependency ranges cover the version being published.

Publish flow:
```bash
npm run build
npm publish --workspaces
```

## CLI files

`**/cli.ts` files are dev-only tools (run with `tsx`). They're included in the build but not intended for consumers.
