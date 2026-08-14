import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Catch a docblock that has come adrift from the thing it describes.
 *
 * Four times in one session's work I inserted a function or a test between an
 * existing docblock and the declaration it belonged to, leaving the comment on
 * my new code and the old declaration bare. Every one was found by a reviewer
 * rather than by me, and one happened in the same session as a commit whose
 * body swore off it. There is a mechanical cause -- an edit anchored on a
 * signature line lands *above* that line, which is inside the gap between a
 * docblock and its code -- and prose in a commit is plainly not a fix for it.
 *
 * What is caught: two docblocks touching, the second opening on the closing
 * line of the first or the line after. The second attaches to whatever follows,
 * so the first attaches to nothing.
 *
 * What is not, and it is half the class. A docblock left on the wrong *sibling*
 * -- a new `it(...)` inserted after a comment, taking it, and leaving the
 * intended test bare further down -- has no adjacency to key on. Four of the
 * fifteen this first found were that shape, and they were found by reading the
 * fifteen rather than by this.
 *
 * A blank line between two docblocks is not flagged. Not because tooling
 * refuses to associate across one, which it does not -- TypeScript will happily
 * attach a JSDoc block over a blank line -- but because a free-standing note
 * above a declaration is a deliberate style here, and a guard against one
 * specific slip has no business being an opinion about that.
 *
 * A test rather than a lint rule or a script, so that it runs in `npm run
 * verify` without anyone having to remember it. That is the whole point: the
 * mistake is one nobody remembers to look for.
 */

/**
 * Where every docblock in the source begins and ends, 1-indexed and inclusive.
 *
 * A character scan and not a line match, because `/**` appears in this codebase
 * inside string literals and template literals -- a docblock quoting example
 * code is an ordinary thing to write here -- and a line-based version reported
 * those as comments. Ordinary block comments are recognised as well, so that a
 * doc opener written inside one is not taken for a real one.
 *
 * Templates nest through `${...}`, and the code inside an interpolation can
 * hold strings of its own, so the state is a stack rather than a flag.
 *
 * Two things it does not understand, both left alone deliberately. A regular
 * expression is not told from a division, so a literal containing an unescaped
 * `/*` would be read as a comment -- no such literal is written here, and the
 * escaped forms in `check-base.ts` scan correctly. And JSX text is not a
 * string, so `/**` written as prose inside an element would be read as syntax.
 * Both want a parser, which is a great deal of machinery for a guard against
 * one specific slip.
 */
function docblockSpans(source: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  const stack: ("'" | '"' | '`' | '${')[] = [];
  let line = 1;
  let i = 0;

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '\n') {
      line++;
      i++;
      continue;
    }
    const top = stack[stack.length - 1];

    if (top === "'" || top === '"' || top === '`') {
      if (c === '\\') {
        i += 2;
      } else if (c === top) {
        stack.pop();
        i++;
      } else if (top === '`' && c === '$' && next === '{') {
        stack.push('${');
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    if (c === '}' && top === '${') {
      stack.pop();
      i++;
    } else if (c === "'" || c === '"' || c === '`') {
      stack.push(c);
      i++;
    } else if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      // An empty block comment opens and closes in four characters, and is
      // not a docblock however much it looks like one.
      const isDoc = source[i + 2] === '*' && source[i + 3] !== '/';
      const start = line;
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') line++;
        i++;
      }
      i += 2;
      if (isDoc) spans.push({ start, end: line });
    } else {
      i++;
    }
  }
  return spans;
}

/** Every 1-indexed line that closes a docblock another docblock is touching. */
export function orphanedDocblocks(source: string): number[] {
  const spans = docblockSpans(source);
  const orphans: number[] = [];
  for (let i = 1; i < spans.length; i++) {
    // Touching means the next one opens on the closing line or the one after
    // it. Both are orphans: two on a line and the first is still attached to
    // nothing, which a line-based version of this missed.
    if (spans[i].start <= spans[i - 1].end + 1) orphans.push(spans[i - 1].end);
  }
  return orphans;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.tsx?$/.test(path)) out.push(path);
  }
  return out;
}

describe('docblocks', () => {
  it('recognises the shape of the mistake', () => {
    expect(orphanedDocblocks('/** a */\n/** b */\nexport const x = 1;\n')).toEqual([1]);
    expect(orphanedDocblocks('/**\n * a\n */\n/**\n * b\n */\nexport const x = 1;\n')).toEqual([3]);
    // Two on one line: the first is attached to nothing just the same, and a
    // line-based version of this let it through.
    expect(orphanedDocblocks('/** a */ /** b */\nexport const x = 1;\n')).toEqual([1]);
  });

  it('leaves alone the shapes that are not it', () => {
    expect(orphanedDocblocks('/** a */\nexport const x = 1;\n')).toEqual([]);
    // A blank line between them is not flagged. Not because tooling refuses to
    // associate across one -- TypeScript will -- but because a free-standing
    // note above a declaration is a deliberate style this codebase uses, and a
    // guard against one specific slip should not be an opinion about that.
    expect(orphanedDocblocks('/** a */\n\n/** b */\nexport const x = 1;\n')).toEqual([]);
    // An ordinary block comment attaches to nothing in the first place.
    expect(orphanedDocblocks('/* a */\n/** b */\nexport const x = 1;\n')).toEqual([]);
    // And `/**` inside one is not an opener.
    expect(orphanedDocblocks('/* holds /** inside */\n/** b */\nexport const x = 1;\n')).toEqual([]);
    // An empty block comment is not a docblock, however much it looks like one.
    expect(orphanedDocblocks('/**/\n/** b */\nexport const x = 1;\n')).toEqual([]);
  });

  /**
   * The false positives a line-based version had, all of which are real code
   * somebody writes: a docblock quoting example source is an ordinary thing in
   * this repository, and it must not fail the build.
   */
  it('does not mistake a string or a template for a comment', () => {
    expect(orphanedDocblocks("const s = '/** a */';\n/** b */\nexport const x = 1;\n")).toEqual([]);
    expect(orphanedDocblocks('const s = `\n/** a */\n/** b */\n`;\n/** c */\nexport const x = 1;\n')).toEqual([]);
    // Through an interpolation, whose own code can hold strings again.
    expect(
      orphanedDocblocks('const s = `${ "/**" + `${ "*/" }` }`;\n/** a */\nexport const x = 1;\n'),
    ).toEqual([]);
    // An escaped quote does not end the string it is in.
    expect(orphanedDocblocks("const s = '\\'/** a */';\n/** b */\nexport const x = 1;\n")).toEqual([]);
    // A line comment is not a docblock and cannot orphan one.
    expect(orphanedDocblocks('// /** a */\n/** b */\nexport const x = 1;\n')).toEqual([]);
  });

  it('finds none in the source', () => {
    const root = process.cwd();
    const found: string[] = [];
    for (const dir of ['src', 'scripts']) {
      for (const path of walk(join(root, dir))) {
        for (const line of orphanedDocblocks(readFileSync(path, 'utf8'))) {
          found.push(`${relative(root, path).split(sep).join('/')}:${line}`);
        }
      }
    }
    // Named rather than counted, because the point of failing is to say which
    // comment lost its function.
    expect(found).toEqual([]);
  });
});
