import type { ReactNode } from 'react';
import { STARTER_PACK } from '@/sim/starter';
import { Rich, useT } from './i18n';
import {
  PACK_GUIDE_INTRO,
  PACK_GUIDE_NAMES,
  PACK_GUIDE_NOT,
  PACK_GUIDE_NOW,
  PACK_GUIDE_OR,
  PACK_GUIDE_REFUSED,
  PACK_GUIDE_SHAPE,
  PACK_GUIDE_TALLIES,
  PACK_GUIDE_WHEN,
  type PackGuideSection,
} from './pack-guide-strings';
import { SamplePack } from './Quests';

/**
 * How to write a quest pack, for the person who wants to.
 *
 * It sits beside the sailing guide because it answers the same kind of
 * question -- "how do I do the thing this game is for" -- and because a guide
 * to a file format that lives in the repository is a guide only people who
 * already found the repository will read. The point of packs is that anyone
 * can write one.
 *
 * **Both examples are generated from the pack the game ships**, rather than
 * written out here. A guide that quotes a format is a guide that goes stale
 * the first time the format moves; one that serialises the real thing cannot.
 * The prose is translated and the vocabulary never is -- see
 * `pack-guide-strings.ts` for why.
 */

/**
 * Pretty-printed, except that anything short enough to fit stays on one line.
 *
 * `JSON.stringify(x, null, 2)` turns `{ "atLeast": 22 }` into three lines and
 * the night-watch example into thirty-four, which reads as a big complicated
 * thing rather than as the small one it is. What a reader has to see here is
 * the *shape*, so the shape gets the vertical space and the leaves do not.
 */
function compactJson(value: unknown, indent = ''): string {
  const flat = JSON.stringify(value);
  if (typeof value !== 'object' || value === null || flat.length <= 60) return flat;
  const pad = `${indent}  `;
  const lines = Array.isArray(value)
    ? value.map((v) => pad + compactJson(v, pad))
    : Object.entries(value).map(([k, v]) => `${pad}${JSON.stringify(k)}: ${compactJson(v, pad)}`);
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  return `${open}\n${lines.join(',\n')}\n${indent}${close}`;
}

/** The shape of a file, from the real one, cut to the first two quests. */
const SHAPE = compactJson({ ...STARTER_PACK, quests: STARTER_PACK.quests.slice(0, 2) });

/** The shipped `any`, so the example of an *or* is one that actually runs. */
const NIGHT = compactJson(STARTER_PACK.quests.find((q) => q.id === 'night')?.ask ?? {});

function Code({ text }: { text: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-secondary/40 p-2.5 font-mono text-[10px] leading-relaxed">
      {text}
    </pre>
  );
}

function Section({ section, children }: { section: PackGuideSection; children?: ReactNode }) {
  const t = useT();
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        <Rich text={t(section.title)} />
      </h3>
      <div className="space-y-2 text-[11px] leading-relaxed">
        {section.paragraphs.map((p, i) => (
          <p key={i}>
            <Rich text={t(p)} />
          </p>
        ))}
      </div>
      {children}
      {section.terms && (
        <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 pt-0.5">
          {section.terms.map(({ term, meaning }) => (
            <div key={term} className="contents">
              {/* Never translated: this is what goes in the file. */}
              <dt className="font-mono text-[10px] text-foreground">{term}</dt>
              <dd className="text-[11px] leading-relaxed text-muted-foreground">
                <Rich text={t(meaning)} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export function PackGuide() {
  const t = useT();
  return (
    <div className="space-y-5">
      <div className="space-y-2 text-[11px] leading-relaxed">
        {PACK_GUIDE_INTRO.map((p, i) => (
          <p key={i}>
            <Rich text={t(p)} />
          </p>
        ))}
      </div>
      <SamplePack />

      <Section section={PACK_GUIDE_SHAPE}>
        <Code text={SHAPE} />
      </Section>
      <Section section={PACK_GUIDE_WHEN} />
      <Section section={PACK_GUIDE_NOW} />
      <Section section={PACK_GUIDE_NAMES} />
      <Section section={PACK_GUIDE_TALLIES} />
      <Section section={PACK_GUIDE_OR}>
        <Code text={NIGHT} />
      </Section>
      <Section section={PACK_GUIDE_REFUSED} />
      <Section section={PACK_GUIDE_NOT} />
    </div>
  );
}
