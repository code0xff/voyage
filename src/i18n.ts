/**
 * Which language the interface is in, as a plain value.
 *
 * Separate from `src/ui/i18n.tsx`, which holds the React context and the
 * renderer, because `settings.ts` needs the type and the browser guess and has
 * no business importing React to get them. Nothing in here touches the DOM
 * beyond reading `navigator`, and nothing imports it that should not.
 */

export type Lang = 'en' | 'ko';

/**
 * Every language, in the order the picker offers them.
 *
 * Adding one is meant to be three edits and no more: a member on `Lang`, a row
 * here with the tag its speakers' browsers send, and the missing half of every
 * `Phrase` -- which the compiler will list for you, because `Record<Lang,
 * string>` cannot be satisfied by omission. Nothing below this line names a
 * language.
 *
 * `label` is written in the language itself. Someone looking for their own
 * language in a list is looking for the word they would write, not the English
 * for it.
 */
export const LANGS: { id: Lang; label: string; tags: string[] }[] = [
  { id: 'en', label: 'English', tags: ['en'] },
  { id: 'ko', label: '한국어', tags: ['ko'] },
];

/** A string that exists in both languages. */
export type Phrase = Record<Lang, string>;

/**
 * The language to open in when the player has never chosen one.
 *
 * Read from the browser rather than defaulted to English. Someone whose machine
 * is set to Korean should not have to find the language setting by reading a
 * language they are looking for the setting because of.
 */
export function detectLang(): Lang {
  if (typeof navigator === 'undefined') return 'en';
  const wanted = navigator.languages?.length ? navigator.languages : [navigator.language ?? ''];
  // In the browser's order of preference, not ours: someone who lists Korean
  // first and English second wants Korean, and walking `LANGS` instead would
  // hand them whichever we happened to put at the top.
  for (const tag of wanted) {
    const lower = tag.toLowerCase();
    const hit = LANGS.find((l) => l.tags.some((t) => lower.startsWith(t)));
    if (hit) return hit.id;
  }
  return 'en';
}
