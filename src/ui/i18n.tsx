import { createContext, useContext, type ReactNode } from 'react';
import type { Lang, Phrase } from '@/i18n';

/**
 * Two languages, no dependency.
 *
 * An i18n library would bring plurals, dates, interpolation and a loader, and
 * this needs none of them: the strings are static, there are a couple of
 * hundred, and the only formatting they want is a bold run and a key cap. A
 * dictionary and forty lines of renderer is the whole thing, and it keeps the
 * translations as flat strings -- which is what makes it possible to see at a
 * glance that the two locales have the same shape.
 *
 * ## What is deliberately *not* translated
 *
 * **The instrument abbreviations.** BSP, VMG, TWA, AWA, SOG, COG, HDG and TWS
 * are international: they are what is printed on a Korean boat's instruments
 * too. Translating them would make the panel easier to read and the player
 * worse at sailing, because the words they had learned would be no use the
 * moment they stepped aboard anything real. The abbreviations stay; the
 * glossary that explains them is translated, which is where the help belongs.
 *
 * **Place names, and where the survey came from.** `San Francisco Bay` is what
 * is written on the chart, and `NOAA NCEI CUDEM 1/9 arc-second` is there so
 * that the claim on screen can be checked against the source. A translated
 * citation is a citation you cannot follow. The one-line `brief` that says what
 * each place asks of you is translated, because that is description rather than
 * reference.
 */

const LangContext = createContext<Lang>('en');

export function LangProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export const useLang = (): Lang => useContext(LangContext);

/** Pick the current language's text out of a phrase. */
export function useT(): (p: Phrase) => string {
  const lang = useLang();
  return (p) => p[lang] ?? p.en;
}

/**
 * Inline markup for translated prose, kept to the two things it actually needs.
 *
 *   **bold**   a run that carries the weight of the sentence
 *   [[T]]      a key cap
 *
 * A translator can move these around a sentence freely, which matters: Korean
 * puts the verb last, so anything that assumed English word order by splitting
 * a sentence into JSX fragments would have forced the translation to be a
 * different sentence. One string per sentence, markers wherever they land.
 */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[\[[^\]]+\]\])/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={i} className="font-medium text-foreground">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith('[[') && part.endsWith(']]')) {
          return (
            <kbd
              key={i}
              className="rounded border border-border bg-secondary px-1 font-mono text-[10px]"
            >
              {part.slice(2, -2)}
            </kbd>
          );
        }
        return part;
      })}
    </>
  );
}
