import { useT } from './i18n';
import { CREDITS } from './strings';

/**
 * Where the two animal models came from.
 *
 * CC BY 4.0 wants the creator, the licence and a link to the original given
 * "in any reasonable manner based on the medium" -- and the medium a player is
 * in is this dialog, not the repository. The README and the ATTRIBUTION.txt
 * beside each asset carry the same notice for anyone reading the source, but a
 * player never opens either, so those alone do not discharge it.
 *
 * The names, the licence and the URLs are references and are deliberately left
 * untranslated, for the same reason the survey citations are: a translated
 * citation is one you cannot follow. Only the label and the note that says what
 * was changed are prose, and those are translated.
 *
 * Joined with separators rather than with "and", so that the line carries no
 * word order for a translation to have to fight.
 */

const LICENCE = { name: 'CC BY 4.0', href: 'https://creativecommons.org/licenses/by/4.0/' };

/**
 * The code that ships with it, as opposed to the art.
 *
 * A plain text file rather than a panel: it is a hundred and thirty licences
 * and nobody reads it, but MIT, BSD and Apache-2.0 all require it to travel
 * with the software and bundling does not change that. Generated at build time
 * from what is actually installed -- see `scripts/notices.ts` -- so it cannot
 * drift from the tree the way a hand-kept list would.
 */
const NOTICES = { name: 'Open-source licences', href: '/third-party-notices.txt' };

/**
 * One line each, and the creator on every line.
 *
 * It was a run-on sentence with a single `AUTHOR` beside it, which held for
 * exactly as long as both models came from the same person. The gulls did not,
 * and went uncredited here -- in the one place a player ever looks, which is
 * the whole reason this component exists. A shape that cannot express a second
 * creator will silently drop one, so the creator belongs to the model.
 */
const MODELS = [
  {
    name: 'Humpback whale',
    href: 'https://sketchfab.com/3d-models/humpback-whale-d3f5039a8c624e099724dd7bcd51a680',
    by: 'eelislay',
    byHref: 'https://sketchfab.com/eelislay',
  },
  {
    name: 'Shark',
    href: 'https://sketchfab.com/3d-models/shark-1b45eb40145a4cf981c601f5d9f168d3',
    by: 'eelislay',
    byHref: 'https://sketchfab.com/eelislay',
  },
  {
    name: 'Seagulls',
    href: 'https://sketchfab.com/3d-models/seagulls-animated-73aed843190a4dfda55f2b65cc0f8d63',
    by: 'vicente betoret ferrero',
    byHref: 'https://sketchfab.com/deathcow',
  },
];

function Ref({ name, href }: { name: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="rounded-sm underline decoration-border underline-offset-2 transition-colors hover:text-foreground hover:decoration-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {name}
    </a>
  );
}

export function Credits() {
  const t = useT();
  return (
    <section className="mt-6 border-t border-border pt-3">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {t(CREDITS.title)}
      </h3>
      <ul className="mt-1.5 space-y-0.5 text-[10px] leading-relaxed text-muted-foreground">
        {MODELS.map((model) => (
          <li key={model.href}>
            <Ref name={model.name} href={model.href} /> — <Ref name={model.by} href={model.byHref} />
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
        All <Ref {...LICENCE} />.
      </p>
      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
        {t(CREDITS.note)}
      </p>
      <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
        {t(CREDITS.code)} <Ref {...NOTICES} />
      </p>
    </section>
  );
}
