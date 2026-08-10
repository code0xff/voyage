import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Collect the licence of every package that ships, and write it where the
 * built app can serve it.
 *
 * This is an obligation rather than a courtesy. MIT, BSD and Apache-2.0 all
 * require their copyright notice and licence text to travel with the software,
 * and a bundled web app is a distribution like any other -- the fact that the
 * bundler has minified the code away does not remove the condition attached to
 * it. Apache-2.0 additionally carries any NOTICE file the package ships.
 *
 * Generated rather than committed, for the reason the build output is: it is
 * derived from `node_modules`, and a copy checked in is a copy that goes stale
 * the first time a dependency moves. `predev` and `prebuild` run it, so the
 * file exists in both the dev server and the bundle without anyone
 * remembering.
 *
 * Deliberately no new dependency. There are plugins that do this; the whole
 * job is walking a directory and reading files, and this project already has a
 * `scripts/` directory for the things that are better run than installed.
 */

const OUT = path.join('public', 'third-party-notices.txt');

/** Filenames a package might have put its licence in. */
const LICENCE_FILES = [
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'LICENCE',
  'LICENCE.md',
  'LICENCE.txt',
  'COPYING',
  'COPYING.md',
];
const NOTICE_FILES = ['NOTICE', 'NOTICE.md', 'NOTICE.txt'];

interface Package {
  name: string;
  version: string;
  licence: string;
  text: string | null;
  notice: string | null;
  repository: string | null;
}

function readFirst(dir: string, names: readonly string[]): string | null {
  for (const name of names) {
    const file = path.join(dir, name);
    if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  }
  return null;
}

/** Whatever the package says its licence is, across the three shapes npm allows. */
function licenceOf(manifest: Record<string, unknown>): string {
  const field = manifest.license ?? manifest.licenses;
  if (typeof field === 'string') return field;
  if (Array.isArray(field)) {
    return field.map((entry) => (entry as { type?: string }).type ?? '?').join(' OR ');
  }
  if (field && typeof field === 'object') return (field as { type?: string }).type ?? 'UNKNOWN';
  return 'UNKNOWN';
}

function collect(): Package[] {
  // npm's own resolution rather than a walk of our own: it is the thing that
  // decides what ends up in the tree, including hoisting and deduplication,
  // and a second implementation of that would only be wrong differently.
  // `npm ls` exits non-zero for any imperfection in the tree -- an unmet peer
  // range, an extraneous package, a workspace it cannot see -- while still
  // printing every path it did resolve. Letting that abort the build would mean
  // a licence file breaking a release over something npm merely disapproves of.
  let listed = '';
  try {
    listed = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (error) {
    listed = String((error as { stdout?: string | Buffer }).stdout ?? '');
  }

  const seen = new Map<string, Package>();
  for (const dir of new Set(listed.split('\n').filter(Boolean))) {
    const manifestPath = path.join(dir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    const name = String(manifest.name ?? '');
    // The root is the thing being licensed, not a thing licensed to us.
    if (!name || name === 'voyage') continue;

    const version = String(manifest.version ?? '');
    const repo = manifest.repository as { url?: string } | string | undefined;
    seen.set(`${name}@${version}`, {
      name,
      version,
      licence: licenceOf(manifest),
      text: readFirst(dir, LICENCE_FILES),
      notice: readFirst(dir, NOTICE_FILES),
      repository: typeof repo === 'string' ? repo : (repo?.url ?? null),
    });
  }

  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function render(packages: Package[]): string {
  const counts = new Map<string, number>();
  for (const p of packages) counts.set(p.licence, (counts.get(p.licence) ?? 0) + 1);
  const summary = [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([licence, n]) => `  ${String(n).padStart(4)}  ${licence}`)
    .join('\n');

  const missing = packages.filter((p) => !p.text);
  const body = packages
    .map((p) => {
      const head = [
        '='.repeat(76),
        `${p.name}  ${p.version}`,
        `License: ${p.licence}`,
        p.repository ? `Source: ${p.repository.replace(/^git\+|\.git$/g, '')}` : null,
        '='.repeat(76),
      ]
        .filter(Boolean)
        .join('\n');
      const text = p.text ?? `(The package ships no licence file. It declares ${p.licence}.)`;
      const notice = p.notice ? `\n\n--- NOTICE ---\n\n${p.notice}` : '';
      return `${head}\n\n${text}${notice}`;
    })
    .join('\n\n\n');

  return `voyage -- third-party licences

Everything below ships inside this application. It is reproduced because the
licences require it: MIT, BSD and Apache-2.0 all ask that their notice travels
with the software, and bundling does not change that.

${packages.length} packages:

${summary}
${missing.length ? `\n${missing.length} of them ship no licence file; their declared licence is stated in place of one.\n` : ''}

${body}
`;
}

const packages = collect();

/*
 * Silence is the failure mode to guard against.
 *
 * Tolerating npm's exit code means a tree it could not read at all produces an
 * empty list rather than an error, and an empty notices file is worse than a
 * broken build: the build gets fixed, and the missing licences ship. So every
 * package this project declares a direct dependency on has to be in there, and
 * if one is not, this stops.
 */
const direct = Object.keys(
  (JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies?: Record<string, string> })
    .dependencies ?? {},
);
const found = new Set(packages.map((p) => p.name));
const absent = direct.filter((name) => !found.has(name));
if (absent.length > 0) {
  throw new Error(
    `Resolved only ${packages.length} packages and none of these, which ship: ` +
      `${absent.join(', ')}. Refusing to write notices that are missing licences.`,
  );
}

writeFileSync(OUT, render(packages));
console.log(`${OUT}: ${packages.length} packages`);
