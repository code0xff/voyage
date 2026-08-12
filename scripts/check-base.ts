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
 * What it checks, and it is worth being plain about the limit. Every string
 * literal in `src/` that names a file which actually exists under `public/`
 * must be the direct argument of `assetUrl()`. That is a lexical rule and it
 * catches the mistake as it is actually made -- someone types the path they see
 * in `public/`. It cannot see a path assembled from variables, and it does not
 * try; `src/terrain-load.ts` builds one from `Region.raster` and carries a
 * comment saying so.
 *
 * `src/sim` is exempt, because it may not fetch and may not read
 * `import.meta.env` (AGENTS.md section 3). A path there is inert data and the
 * prefix belongs to whoever loads it.
 *
 * Given a built `dist`, it also checks that the entry `index.html` points at
 * the base it was built with -- which is the one path Vite *does* rewrite, and
 * so the one that proves the build actually received `VOYAGE_BASE`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

function walk(dir: string, keep: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path, keep));
    else if (keep(path)) out.push(path);
  }
  return out;
}

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
  (path) =>
    /\.tsx?$/.test(path) &&
    !path.includes(`${sep}components${sep}ui${sep}`) &&
    !path.endsWith('.test.ts') &&
    !path.endsWith('.test.tsx'),
);

for (const path of sources) {
  const text = readFileSync(path, 'utf8');
  const inSim = path.includes(`${sep}src${sep}sim${sep}`);
  for (const match of text.matchAll(/(\w*)\(?\s*(['"`])(\/[^'"`\n]*)\2/g)) {
    const [, callee, , served] = match;
    if (!publicFiles.has(served)) continue;
    if (callee === 'assetUrl') continue;
    if (inSim) continue;
    const line = text.slice(0, match.index).split('\n').length;
    problems.push(
      `${relative(ROOT, path)}:${line}: '${served}' is served from the root and is not wrapped in assetUrl()`,
    );
  }
}

const [dist, base] = process.argv.slice(2);
if (dist) {
  if (!base) {
    problems.push('a dist to check needs the base it was built with as the second argument');
  } else {
    const html = readFileSync(join(ROOT, dist, 'index.html'), 'utf8');
    for (const match of html.matchAll(/(?:src|href)="(\/[^"]*)"/g)) {
      const url = match[1];
      if (!url.startsWith(base)) problems.push(`${dist}/index.html: '${url}' is not under '${base}'`);
    }
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
