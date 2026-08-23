import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MAX_REEF } from '../src/sim/sailplan';
import { GUIDE, GUIDE_WARNING } from '../src/ui/guide-strings';
import { KEYS } from '../src/ui/strings';

/**
 * Catch a key that is bound twice, pressed by something that nothing reads, or
 * written down where it is not true.
 *
 * The anchor sat on A for weeks while A was also the helm. Nobody saw the two
 * written down together because they are not written down together: one is a
 * `wasPressed` in the engine loop, the other a getter in `Input`, and the four
 * places the key is *told to the player* are a third and fourth file again. At
 * sea the collision hid, because letting go is refused where there is nowhere
 * to hold -- so the one place it fired was bearing away to port into an
 * anchorage, which let the anchor go under her and wrote the passage up.
 *
 * Moving it to V then broke the touch strip, which still injected 'a': a button
 * that pressed a key the engine no longer read, and therefore did nothing at
 * all. That is the same mistake from the other side, and it survived a clean
 * self-review of the commit that caused it.
 *
 * And `[ ]` was listed in the README as the mean wind speed for seventeen days
 * after the weather model took the wind over and its consumer was deleted --
 * a documented control that had quietly become nothing.
 *
 * The three are one class: the binding, the thing that presses it and the thing
 * that names it live in different files, and no compiler relates them. So this
 * relates them by reading the sources. Four questions:
 *
 *   1. does every key the touch strip presses reach something?
 *   2. is any key both a one-shot press and a held axis?
 *   3. is every bound key shown to the player?
 *   4. is every key shown to the player actually bound?
 *   5. does the guide teach a key that is bound to anything?
 *
 * A source scan and not a type, because the binding *is* a string literal in
 * four unrelated files and making it anything else would be a large refactor
 * of live code to serve a test. A test rather than a script, so it runs in
 * `npm run verify` without anyone having to remember it -- which is the whole
 * point, since this is a mistake nobody remembers to look for.
 *
 * What it cannot see: a key bound in a file it does not read, a label whose
 * text happens to be a single letter that is not a key, and whether the
 * *action* on a key is the one its label claims. All three want a human.
 */

const root = process.cwd();
const src = (path: string) => readFileSync(join(root, 'src', path), 'utf8');

/** Every key `engine.ts` reads as a one-shot press. */
export function oneShotKeys(engine: string): Set<string> {
  const keys = new Set<string>();
  for (const m of engine.matchAll(/wasPressed\('([^']+)'\)/g)) keys.add(m[1]);
  // The reef keys are pressed through `String(i + 1)`, which no regex can
  // read. Added by hand -- and the loop is asserted to still be there, so the
  // hand-written half cannot outlive the code it stands in for.
  expect(engine, 'the reef loop this test hard-codes has gone').toContain(
    "input.wasPressed(String(i + 1))",
  );
  for (let i = 0; i <= MAX_REEF; i++) keys.add(String(i + 1));
  // Anything else computed is a binding this test cannot see, and silence
  // about it would be worse than a failure.
  // One level of nesting allowed, so that `String(i + 1)` reads as one
  // argument rather than stopping at its own bracket.
  const computed = [...engine.matchAll(/wasPressed\(((?:[^()]|\([^()]*\))*)\)/g)]
    .map((m) => m[1])
    .filter((arg) => !/^'[^']+'$/.test(arg) && arg !== 'String(i + 1)');
  expect(computed, 'a key is pressed by an expression this test cannot read').toEqual([]);
  return keys;
}

/**
 * Every key `Input` reads as held.
 *
 * Both spellings, because the class uses both: the axes go through `axis()`
 * with a list either side, and `centreHelm` asks `held` directly.
 */
export function heldKeys(input: string): Set<string> {
  const keys = new Set<string>();
  for (const call of input.matchAll(/this\.axis\(([\s\S]*?)\);/g)) {
    for (const k of call[1].matchAll(/'([^']*)'/g)) keys.add(k[1]);
  }
  for (const m of input.matchAll(/this\.held\.has\('([^']*)'\)/g)) keys.add(m[1]);
  return keys;
}

/** Every key the touch strip presses on the player's behalf. */
export function injectedKeys(touch: string): Set<string> {
  return new Set([...touch.matchAll(/press\('([^']+)'\)/g)].map((m) => m[1]));
}

/**
 * The keys a label names.
 *
 * Labels are key names and separators -- `← →  /  A D`, `1 2 3 4`, `F / G` --
 * so a token of one character is a key and anything longer is a word about
 * one (`wheel`, `drag chart`). `Esc` and `Space` are the two named in full.
 */
export function labelledKeys(label: string): string[] {
  const out: string[] = [];
  for (const token of label.split(/[\s/]+/)) {
    const t = token.toLowerCase();
    if (t === 'esc') out.push('escape');
    else if (t === 'space') out.push(' ');
    else if (t === '←') out.push('arrowleft');
    else if (t === '→') out.push('arrowright');
    else if (t === '↑') out.push('arrowup');
    else if (t === '↓') out.push('arrowdown');
    // Any single character, and not just a letter or a digit: `[ ]` was
    // listed in the README long after it was bound to nothing, and a parser
    // that only knew about letters could not see the row it was on.
    else if (t.length === 1) out.push(t);
  }
  return out;
}

/** The keys the README's controls table claims, read out of its first column. */
export function readmeKeys(readme: string): Set<string> {
  const start = readme.indexOf('\n## Controls');
  expect(start, 'the README no longer has a Controls section').toBeGreaterThan(-1);
  const table = readme.slice(start, readme.indexOf('\n## ', start + 1));
  const keys = new Set<string>();
  for (const row of table.split('\n')) {
    if (!row.startsWith('|')) continue;
    const cell = row.split('|')[1] ?? '';
    // Only what is in backticks: the first column also holds prose rows like
    // "wheel or pinch over the chart", which name no key.
    for (const span of cell.matchAll(/`([^`]+)`/g)) {
      for (const k of labelledKeys(span[1])) keys.add(k);
    }
  }
  return keys;
}

/** For a message that names the key rather than counting them. */
const list = (keys: Iterable<string>) => [...keys].sort();

describe('keys', () => {
  const engine = src('engine.ts');
  const input = src('input.ts');
  const touch = src('ui/TouchControls.tsx');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');

  const oneShot = oneShotKeys(engine);
  const held = heldKeys(input);
  const bound = new Set([...oneShot, ...held]);
  const shown = new Set(KEYS.flatMap(([label]) => labelledKeys(label)));

  it('reads every key the touch strip presses', () => {
    const dead = list(injectedKeys(touch)).filter((k) => !oneShot.has(k));
    expect(dead, 'a touch button presses a key nothing reads').toEqual([]);
  });

  it('does not put a one-shot press on a key the helm or a sheet holds', () => {
    expect(list(oneShot).filter((k) => held.has(k)), 'bound twice').toEqual([]);
  });

  it('shows every bound key to the player', () => {
    expect(list(bound).filter((k) => !shown.has(k)), 'bound, but not in KEYS').toEqual([]);
    expect(list(bound).filter((k) => !readmeKeys(readme).has(k)), 'bound, not in README').toEqual(
      [],
    );
  });

  it('binds every key it shows the player', () => {
    expect(list(shown).filter((k) => !bound.has(k)), 'in KEYS, bound to nothing').toEqual([]);
    expect(
      list(readmeKeys(readme)).filter((k) => !bound.has(k)),
      'in README, bound to nothing',
    ).toEqual([]);
  });

  /**
   * The guide names keys in prose, in both languages, and it is the fifth place
   * the anchor's key is written down -- the one the move to V missed.
   *
   * Be clear about what this does and does not catch, because it is weaker than
   * the miss it came from. It catches a key the guide names that is bound to
   * nothing. It did *not* catch `[[A]]` for the anchor, and could not: A is a
   * real binding, it is simply the helm, and telling that from the anchor is a
   * question about meaning. Only a single source for each key would close
   * that, and the keys are string literals in five files.
   *
   * One direction only. The guide teaches a chosen few on purpose, so a bound
   * key it never mentions is not a defect.
   */
  it('teaches only keys that are bound', () => {
    const phrases = [GUIDE_WARNING, ...GUIDE.flatMap((s) => [s.title, ...s.paragraphs])];
    const taught = new Set(
      phrases.flatMap((phrase) =>
        Object.values(phrase).flatMap((text) =>
          [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].toLowerCase()),
        ),
      ),
    );
    expect(
      list(taught).filter((k) => !bound.has(k)),
      'the guide names a key that is bound to nothing',
    ).toEqual([]);
  });

  it('recognises the shape of a label', () => {
    expect(labelledKeys('←  →  /  A D')).toEqual(['arrowleft', 'arrowright', 'a', 'd']);
    expect(labelledKeys('Esc')).toEqual(['escape']);
    expect(labelledKeys('Space')).toEqual([' ']);
    // A word about a key is not a key, however short.
    expect(labelledKeys('N / wheel / pinch on chart')).toEqual(['n']);
    expect(labelledKeys('double-click')).toEqual([]);
    // Not only letters and digits -- the bracket keys were once a binding.
    expect(labelledKeys('[ ]')).toEqual(['[', ']']);
  });
});
