/**
 * Catch a public file whose path was written absolute and never given the base.
 *
 * The models, the attribution notices, the licence dump and the six surveyed
 * rasters are fetched at runtime rather than imported, so Vite never sees those
 * strings and never rewrites them. Written as `/assets/...` they resolve
 * against the origin, which is correct served from the root and wrong
 * everywhere else -- and the failure is silent in exactly the configuration
 * everyone develops in. Nothing in `npm run verify` can see it: the base is a
 * build input, the tests run at `/`, and at `/` the bug does not exist.
 *
 *     npm run check:base                # source only
 *     npm run check:base -- dist /voyage/
 *
 * **What is already safe, and is not checked.** Vite rewrites a root-absolute
 * path wherever it can see one statically -- an `href` or `src` in
 * `index.html`, a `url()` in CSS. Both were measured rather than assumed: built
 * at `/voyage/`, `href="/third-party-notices.txt"` came out as
 * `/voyage/third-party-notices.txt` and `url("/third-party-notices.txt")` as
 * `url(/voyage/third-party-notices.txt)`. So HTML and CSS need no rule here,
 * and a rule would only produce false positives.
 *
 * **What is checked.** Every string literal in the TypeScript under `src/` that
 * names a file which actually exists under `public/` must be the direct
 * argument of `assetUrl()`. That is a lexical rule and it catches the mistake
 * as it is actually made -- someone types the path they see in `public/`.
 *
 * **Where it is blind**, in full:
 *
 * - a path assembled from variables. `src/terrain-load.ts` builds one from
 *   `Region.raster` and carries a comment saying so.
 * - `src/sim`, exempted because it may not fetch and may not read
 *   `import.meta.env` (AGENTS.md section 3). A path there is inert data and the
 *   prefix belongs to whoever loads it.
 *
 * `src/components/ui` used to be a third, excluded out of habit because lint
 * excludes it. Lint excludes it because it is generated and its style is not
 * ours; that is no reason at all to let a fetch in it break the deploy, and a
 * design-system primitive taking an image path is an ordinary thing. It is
 * scanned.
 *
 * Given a built `dist`, it also checks the entry `index.html`: every reference
 * into the emitted `assets/` directory must sit under the base. That is the one
 * path Vite does rewrite, and so the proof the build actually received
 * `VOYAGE_BASE`.
 *
 * The two judgements are exported and tested in `check-base.test.ts`. Both were
 * wrong in their first version and both failed *open*, which is the failure
 * mode this whole script exists to prevent someone else from having.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The last line with any `//` comment on it cut away.
 *
 * A scan rather than `/\/\/[^\n]*$/`, which was the first attempt and cut at
 * the `//` in `https://`. This file's own neighbourhood is full of them --
 * `Credits.tsx` puts a Sketchfab URL beside every `assetUrl()` call -- and a
 * wrapped call sharing a line with one was reported as unwrapped. That fails
 * closed rather than open, so it was noise and not a hole, but it is noise
 * aimed squarely at correct code.
 */
function withoutLineComment(head: string): string {
  const start = head.lastIndexOf('\n') + 1;
  const line = head.slice(start);
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || char === '`') {
      quote = char;
    } else if (char === '/' && line[i + 1] === '/') {
      return head.slice(0, start + i);
    }
  }
  return head;
}

/**
 * Is this string literal the direct argument of `assetUrl(`?
 *
 * @param before everything in the file up to the literal's opening quote.
 *
 * Read backwards from the quote rather than forwards from a callee, which is
 * what the first version did and got wrong in both directions: it took the last
 * word before the quote, so `window.assetUrl('/x')` passed on a name it had not
 * really matched, and a comment between the paren and the path was reported as
 * unsafe because the last word was the comment.
 */
export function wrappedInAssetUrl(before: string): boolean {
  let head = before.trimEnd();
  // Comments sit between the paren and the path exactly where this project
  // tends to put them, so they are stepped over rather than tripped on.
  for (;;) {
    const stripped = withoutLineComment(head).replace(/\/\*[^]*?\*\/$/, '').trimEnd();
    if (stripped === head) break;
    head = stripped;
  }
  // The character before the name matters: a `.` means this is some other
  // object's method that merely shares the spelling.
  return /(^|[^\w.$])assetUrl\s*\($/.test(head);
}

/**
 * Every reference in a built `index.html` that points into the emitted bundle.
 *
 * Picked out by what they point *at* rather than by starting with a slash,
 * which was the first version's rule. Vite accepts a root-relative base, an
 * absolute one for a CDN and `./` for a relative build, and emits a different
 * shape of URL for each -- so the slash rule quietly matched nothing at all on
 * a CDN build, and passed a build for one CDN against the base of another.
 */
export function bundledRefs(html: string): string[] {
  return [...html.matchAll(/(?:src|href)="([^"]*\bassets\/[^"]*)"/g)].map((match) => match[1]);
}

function walk(dir: string, keep: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path, keep));
    else if (keep(path)) out.push(path);
  }
  return out;
}

function main(): void {
  const ROOT = process.cwd();
  const problems: string[] = [];

  // Every file the site actually serves from the root, as the path it is served
  // at. Derived from `public/` rather than listed, so a new asset is covered the
  // day it is added and not the day someone remembers this file.
  const publicFiles = new Set(
    walk(join(ROOT, 'public'), () => true).map(
      (path) => `/${relative(join(ROOT, 'public'), path).split(sep).join('/')}`,
    ),
  );

  const sources = walk(
    join(ROOT, 'src'),
    (path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path),
  );

  for (const path of sources) {
    if (path.includes(`${sep}src${sep}sim${sep}`)) continue;
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(/(['"`])(\/[^'"`\n]*)\1/g)) {
      const served = match[2];
      if (!publicFiles.has(served)) continue;
      if (wrappedInAssetUrl(text.slice(0, match.index))) continue;
      const line = text.slice(0, match.index).split('\n').length;
      problems.push(
        `${relative(ROOT, path)}:${line}: '${served}' is served from the root and is not wrapped in assetUrl()`,
      );
    }
  }

  const [dist, base] = process.argv.slice(2);
  if (dist && !base) {
    problems.push('a dist to check needs the base it was built with as the second argument');
  } else if (dist && base) {
    const refs = bundledRefs(readFileSync(resolve(ROOT, dist, 'index.html'), 'utf8'));
    // It must have found some, because "nothing to check" and "everything
    // checked out" are otherwise the same exit code.
    if (refs.length === 0) {
      problems.push(`${dist}/index.html: no bundled asset references found -- is this a Vite build?`);
    }
    for (const url of refs) {
      if (!url.startsWith(base)) problems.push(`${dist}/index.html: '${url}' is not under '${base}'`);
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    console.error(`\n${problems.length} path(s) would break anywhere but the site root.`);
    process.exit(1);
  }

  console.log(
    `${publicFiles.size} public file(s), ${sources.length} source(s) checked${dist ? `, ${dist} built for '${base}'` : ''}: every served path carries the base.`,
  );
}

// Only when run as a command. The tests import the two judgements above, and
// importing must not walk the tree, read argv or exit the process.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
