import { existsSync, readdirSync } from "fs";
import { resolve, dirname, basename, join } from "path";

/**
 * Flags that consume the next argument as their value (not part of the path).
 */
const FLAGS_WITH_VALUES = new Set(["--output"]);

/**
 * Resolve a file path from CLI arguments, handling drag-and-drop artifacts.
 *
 * When a file is dragged into a terminal on macOS, the shell may:
 *  - Backslash-escape spaces, ampersands, parentheses, etc.
 *  - Split the path into multiple argv entries if quoting is incomplete.
 *  - Eat special characters like `&` even inside quotes when lines wrap.
 *
 * This function joins all non-flag arguments, strips leftover escape
 * backslashes, trims surrounding quotes/whitespace, and if the exact path
 * doesn't exist, walks up to find the deepest valid ancestor and fuzzy-matches
 * each missing segment against the actual directory contents.
 */
export function resolvePathFromArgs(args: string[]): string {
  const pathParts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (FLAGS_WITH_VALUES.has(args[i])) {
      i++; // skip the flag's value
    } else if (!args[i].startsWith("--")) {
      pathParts.push(args[i]);
    }
  }

  if (pathParts.length === 0) {
    return "";
  }

  let raw = pathParts.join(" ");

  // Strip surrounding single or double quotes
  raw = raw.replace(/^(['"])(.*)\1$/, "$2");

  // Remove backslash escapes added by drag-and-drop (e.g. `\ `, `\&`, `\(`)
  raw = raw.replace(/\\(?=[ &()'])/g, "");

  raw = raw.trim();

  const resolved = resolve(raw);

  if (existsSync(resolved)) {
    return resolved;
  }

  // Fuzzy resolve: walk the path segments and match against disk contents
  // when a segment doesn't exist (e.g. shell ate `&` from a folder name).
  const fuzzyResolved = fuzzyResolvePath(resolved);
  if (fuzzyResolved) {
    return fuzzyResolved;
  }

  console.error(`File not found: ${resolved}`);
  process.exit(1);
}

/**
 * Walk the path from root to leaf. At each level, if the segment doesn't
 * match an entry exactly, find the entry whose name matches after collapsing
 * whitespace and stripping punctuation (handles missing `&`, extra spaces, etc).
 */
function fuzzyResolvePath(fullPath: string): string | null {
  const segments = fullPath.split("/");
  let current = "/";

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg) continue;

    const exact = join(current, seg);
    if (existsSync(exact)) {
      current = exact;
      continue;
    }

    // Segment doesn't exist — try fuzzy match against directory entries
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return null;
    }

    const normalize = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9]/g, "");

    const target = normalize(seg);
    const match = entries.find((e) => normalize(e) === target);

    if (!match) {
      return null;
    }

    current = join(current, match);
  }

  return existsSync(current) ? current : null;
}
