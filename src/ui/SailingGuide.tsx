import { Rich, useT } from './i18n';
import {
  GLOSSARY,
  GUIDE,
  GUIDE_GLOSSARY_TITLE,
  GUIDE_WARNING,
  type GuideSection,
} from './guide-strings';

/**
 * How to sail her, and what every number on screen means.
 *
 * The menu had a key list and nothing else, which answers "what does this
 * button do" and none of "why will the boat not go where I am pointing it".
 * Sailing has a large vocabulary and one genuinely counter-intuitive rule, and
 * a simulator that models both and explains neither is only legible to people
 * who already sail.
 *
 * **Every figure is this boat's, measured, not a sailing textbook's.** The
 * angles come from `npm run polar` and move when the boat is tuned; a guide
 * quoting the usual "45 degrees" would have been wrong in light air and wrong
 * again in a gale, both of which this model gets right. Where the simulator
 * departs from a real yacht -- running dead downwind really is fastest here,
 * because there is no spinnaker -- it says so rather than teaching something
 * that is untrue of the thing in front of you.
 *
 * The text lives in `guide-strings.ts` so that it can exist in two languages.
 * This file is only the shape of it, which is the same in both.
 */

function Section({ section }: { section: GuideSection }) {
  const t = useT();
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {t(section.title)}
      </h3>
      <div className="space-y-2 text-[11px] leading-relaxed">
        {section.paragraphs.map((p, i) => (
          <p key={i}>
            <Rich text={t(p)} />
          </p>
        ))}
      </div>
    </section>
  );
}

export function SailingGuide() {
  const t = useT();
  return (
    <div className="space-y-5">
      <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
        <p className="text-[11px] leading-relaxed">
          <Rich text={t(GUIDE_WARNING)} />
        </p>
      </div>

      {GUIDE.map((section, i) => (
        <Section key={i} section={section} />
      ))}

      <section className="space-y-1.5">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {t(GUIDE_GLOSSARY_TITLE)}
        </h3>
        <dl className="grid grid-cols-[52px_1fr] gap-x-3 gap-y-1.5">
          {GLOSSARY.map(({ term, meaning }) => (
            <div key={term} className="contents">
              {/* Not translated, and that is the point: these are what a real
                  boat's instruments read anywhere in the world. */}
              <dt className="font-mono text-[10px] uppercase tracking-wide text-foreground">
                {term}
              </dt>
              <dd className="text-[11px] leading-relaxed text-muted-foreground">{t(meaning)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
