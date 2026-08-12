import { assetUrl } from '../asset';
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
 * Who owns this, and from when.
 *
 * **`OWNER` is deliberately empty, and nothing renders until it is filled in.**
 * That is the one thing to change; the year below it and the line in the panel
 * take care of themselves.
 *
 * Why it is here at all. Every licence on this screen is someone else's grant
 * to us -- three models under CC BY, a hundred and thirty packages under MIT
 * and friends -- and a page that lists only those reads as though the whole
 * thing were assembled from other people's work. Almost none of it is: the
 * physics, the shaders, the sound and the rest are written for this project and
 * are not being given away. This is the sentence that says so.
 *
 * It is a claim rather than a grant, which is why it is not a licence file.
 * Copyright exists from the moment the thing is written, with or without a
 * notice -- the Berne Convention settled that -- so this creates nothing. It
 * announces, which matters in two practical ways: it removes any "I thought it
 * was free" defence, and it tells anyone who wants to license or reuse a piece
 * of it who to ask.
 *
 * Any name will do: a legal name, a studio, a domain. Copyright does not care.
 * Under US law an anonymous or pseudonymous work runs 95 years from publication
 * rather than the author's life plus 70, but registering under a real name
 * fixes that whatever this string says -- the notice and the registration are
 * separate things.
 */
/*
 * A pen name, deliberately, and not the handle this repository is kept under.
 *
 * That handle is attached to a day job, and this is not that -- so the one
 * string a player can see is the one place the two must not be joined up. It is
 * the last link in that chain rather than the first: the repository is private,
 * the build carries no source map, no absolute path and no author field, and
 * `package.json` names nobody. Checked, not assumed.
 *
 * What is still joined up is the commit history, which is signed with a real
 * name and address 208 times over. That costs nothing while the repository
 * stays private and everything the day the it does not, so it is a decision to
 * take before publishing rather than after.
 *
 * Rendered as plain text and never as a link. It reads like a domain and is not
 * one -- `.iv` is not a TLD -- and this screen is otherwise wall to wall with
 * live links, so making it clickable would promise a page that cannot exist.
 */
const OWNER: string = 'baudouin.iv';
/** First publication. Becomes a range -- `2026-2027` -- on the first year it changes. */
const YEAR = 2026;

/**
 * The code that ships with it, as opposed to the art.
 *
 * A plain text file rather than a panel: it is a hundred and thirty licences
 * and nobody reads it, but MIT, BSD and Apache-2.0 all require it to travel
 * with the software and bundling does not change that. Generated at build time
 * from what is actually installed -- see `scripts/notices.ts` -- so it cannot
 * drift from the tree the way a hand-kept list would.
 */
const NOTICES = { name: 'Open-source licences', href: assetUrl('/third-party-notices.txt') };

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
    notice: assetUrl('/assets/whale/ATTRIBUTION.txt'),
  },
  {
    name: 'Shark',
    href: 'https://sketchfab.com/3d-models/shark-1b45eb40145a4cf981c601f5d9f168d3',
    by: 'eelislay',
    byHref: 'https://sketchfab.com/eelislay',
    notice: assetUrl('/assets/shark/ATTRIBUTION.txt'),
  },
  {
    name: 'Seagulls',
    href: 'https://sketchfab.com/3d-models/seagulls-animated-73aed843190a4dfda55f2b65cc0f8d63',
    by: 'vicente betoret ferrero',
    byHref: 'https://sketchfab.com/deathcow',
    notice: assetUrl('/assets/gull/ATTRIBUTION.txt'),
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
            <Ref name={model.name} href={model.href} /> — <Ref name={model.by} href={model.byHref} />{' · '}
            <Ref name={t(CREDITS.changes)} href={model.notice} />
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
        {t(CREDITS.allUnder)} <Ref {...LICENCE} />.
      </p>
      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
        {t(CREDITS.note)}
      </p>
      <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
        {t(CREDITS.code)} <Ref {...NOTICES} />
      </p>
      {/* Last, and set apart. Everything above it is someone else's grant to
          this project; this is the one line that runs the other way, and it
          would read as one more attribution sitting among them.

          Absent entirely until `OWNER` is set, rather than shipping a blank or
          a placeholder: a notice naming nobody is not a weaker claim than none,
          it is a broken line of text in front of a player.

          Untranslated on purpose, and noted here so it is not mistaken for a
          missed string later: "Copyright (c) ... All rights reserved" is a
          formula rather than prose, printed in this form on Korean products
          too, and it sits with the licence names and citations that this file
          already keeps as references. */}
      {OWNER && (
        <p className="mt-3 border-t border-border/60 pt-2 text-[10px] leading-relaxed text-muted-foreground">
          Copyright © {YEAR} {OWNER}. All rights reserved.
        </p>
      )}
    </section>
  );
}
