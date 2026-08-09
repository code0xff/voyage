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

const AUTHOR = { name: 'eelislay', href: 'https://sketchfab.com/eelislay' };

const LICENCE = { name: 'CC BY 4.0', href: 'https://creativecommons.org/licenses/by/4.0/' };

const MODELS = [
  {
    name: 'Humpback whale',
    href: 'https://sketchfab.com/3d-models/humpback-whale-d3f5039a8c624e099724dd7bcd51a680',
  },
  {
    name: 'Shark',
    href: 'https://sketchfab.com/3d-models/shark-1b45eb40145a4cf981c601f5d9f168d3',
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
      <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
        {MODELS.map((model, i) => (
          <span key={model.href}>
            {i > 0 && ' · '}
            <Ref {...model} />
          </span>
        ))}
        {' — '}
        <Ref {...AUTHOR} />
        {' · '}
        <Ref {...LICENCE} />
      </p>
      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
        {t(CREDITS.note)}
      </p>
    </section>
  );
}
