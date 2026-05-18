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

**CRITICAL:** When bumping versions, you MUST update **every** version reference in the monorepo. Workspace resolution masks version mismatches locally — npm workspaces always resolve to the local copy regardless of the version string. Exact-pinned or stale dependency versions only break for external consumers installing from npm, causing duplicate nested `node_modules` copies.

### Full checklist (every item is mandatory)

1. **Root `package.json`** — `"version"` field
2. **Every `packages/*/package.json`** — `"version"` field
3. **Every `@parseo/*` dependency in every `packages/*/package.json`** — must use `^` caret ranges matching the current version (e.g. if bumping to `1.0.6`, set `"^1.0.6"`), never exact pins and never stale ranges. This includes:
   - `packages/core/package.json` — depends on all other `@parseo/*` packages
   - `packages/appraisals/package.json` — depends on `@parseo/shared`
   - `packages/background-checks/package.json` — depends on `@parseo/shared`
   - `packages/bank-statements/package.json` — depends on `@parseo/shared`
   - `packages/credit-reports/package.json` — depends on `@parseo/shared`

### Verification step

After updating, run: `grep -r '"@parseo/' packages/*/package.json` and confirm **no exact pins** remain (every `@parseo/*` dep must start with `^`).

### Publish flow
```bash
npm version patch --workspaces --include-workspace-root
npm run build
npm publish --workspaces
```

## CLI files

`**/cli.ts` files are dev-only tools (run with `tsx`). They're included in the build but not intended for consumers.
