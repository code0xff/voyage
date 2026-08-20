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
 * physics, the shaders, the sound and the rest are written for this project.
 * This is the line that says who wrote them and on what terms.
 *
 * It said "All rights reserved" until the project took a licence. That was a
 * claim rather than a grant, which is why it was not a licence file; now there
 * is one -- `LICENSE`, the GNU AGPL v3 -- and this line points at it. Both
 * halves matter: copyright exists from the moment the thing is written, with
 * or without a notice, and the licence is what lets anyone else do anything
 * with it.
 *
 * The AGPL is the reason a player can see this at all. Section 13 obliges
 * anyone who runs a modified copy *over a network* to offer its source to the
 * people using it -- a browser game is served, not shipped, so that is the
 * clause that does the work here.
 *
 * Any name will do: a legal name, a studio, a domain. Copyright does not care.
 * Under US law an anonymous or pseudonymous work runs 95 years from publication
 * rather than the author's life plus 70, but registering under a real name
 * fixes that whatever this string says -- the notice and the registration are
 * separate things.
 */
/*
 * A pen name, and no longer a separation.
 *
 * It was chosen while the repository was private, to keep this project's one
 * player-visible string apart from the handle the work is kept under -- and
 * the paragraph here used to list what else was checked: no source map, no
 * absolute path, no author field, nobody named in `package.json`.
 *
 * It also said the remaining link was the commit history, signed with a real
 * name and address four hundred times over, and that publishing was therefore
 * a decision to take beforehand rather than after. That decision has been
 * taken: the repository is public, under the AGPL, with its history intact.
 * The pen name stays because it is what the screen has always said and a
 * credit line is not improved by changing whose it is -- but it is a name
 * now, not a wall, and anyone who wants the other one has four hundred
 * commits to read it off.
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
 * Where this came from, which the licence obliges.
 *
 * AGPL section 13: run a modified copy over a network and you owe its source
 * to the people using it. A browser game is served rather than shipped, so
 * that clause is the one that does the work -- and the licence's own appendix
 * says how to discharge it, in as many words: *if your program is a web
 * application, its interface could display a "Source" link that leads users to
 * an archive of the code.* This is that link.
 */
const SOURCE = { name: 'Source', href: 'https://github.com/code0xff/voyage' };

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
      {/* The offer of source, which the licence obliges rather than invites --
          and it sits above the copyright line for the same reason that line
          sits last: this one is a grant to the player, and the one below it is
          the claim it is granted from. */}
      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
        {t(CREDITS.source)} <Ref {...SOURCE} />
      </p>
      {/* Last, and set apart. Everything above it is someone else's grant to
          this project; this is the one line that runs the other way, and it
          would read as one more attribution sitting among them.

          Absent entirely until `OWNER` is set, rather than shipping a blank or
          a placeholder: a notice naming nobody is not a weaker claim than none,
          it is a broken line of text in front of a player.

          Untranslated on purpose, and noted here so it is not mistaken for a
          missed string later: a copyright line and a licence name are formulae
          rather than prose, printed in this form on Korean products too, and
          they sit with the licence names and citations that this file already
          keeps as references. */}
      {OWNER && (
        <p className="mt-3 border-t border-border/60 pt-2 text-[10px] leading-relaxed text-muted-foreground">
          Copyright © {YEAR} {OWNER}. Licensed under the{' '}
          <a
            className="underline decoration-dotted underline-offset-2 hover:text-foreground"
            href="https://www.gnu.org/licenses/agpl-3.0.html"
            target="_blank"
            rel="noreferrer"
          >
            GNU AGPL v3
          </a>
          .
        </p>
      )}
    </section>
  );
}
