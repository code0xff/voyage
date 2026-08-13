import { describe, expect, it } from 'vitest';
import { bundledRefs, wrappedInAssetUrl } from './check-base';

/**
 * The two judgements the base check rests on.
 *
 * Tested because both were wrong in their first version and both failed *open*
 * -- they reported a clean pass over a deployment that would not have loaded.
 * A guard that can only fail silently is worse than no guard, because it is
 * also believed.
 */
describe('wrappedInAssetUrl', () => {
  const upTo = (source: string) => source.slice(0, source.indexOf("'/"));

  it('accepts the ordinary call', () => {
    expect(wrappedInAssetUrl(upTo("const url = assetUrl('/assets/shark/shark.glb');"))).toBe(true);
  });

  it('accepts a comment between the paren and the path', () => {
    expect(
      wrappedInAssetUrl(upTo("assetUrl(/* wherever this is deployed */ '/assets/shark/shark.glb')")),
    ).toBe(true);
  });

  it('rejects a bare literal', () => {
    expect(wrappedInAssetUrl(upTo("const url = '/assets/shark/shark.glb';"))).toBe(false);
  });

  /**
   * The name has to be the function and not merely end with it. Reading the
   * last word before the quote said yes to this, which is a guard that can be
   * satisfied by a coincidence of spelling.
   */
  /**
   * A URL is not a comment. `Credits.tsx` puts a Sketchfab link beside every
   * `assetUrl()` call, so a `//` sharing the line with a wrapped call is the
   * normal case here and not a contrived one.
   */
  it('accepts a call sharing its line with a string containing //', () => {
    expect(
      wrappedInAssetUrl(upTo("const site = 'https://sketchfab.com/x'; const u = assetUrl('/assets/shark/shark.glb');")),
    ).toBe(true);
  });

  it('accepts a call with a line comment between the paren and the path', () => {
    expect(wrappedInAssetUrl(upTo("const u = assetUrl( // wherever this is deployed\n  '/assets/shark/shark.glb',\n);"))).toBe(true);
  });

  /**
   * A mention of the call inside a comment is not the call. This one failed
   * *open* -- the raw path went unreported -- because the line-comment cut was
   * taken inside the block comment and left its `assetUrl(` looking like the
   * caller. Contrived as an input, and exactly the class of hole this script
   * exists to not have.
   */
  it('rejects a path whose only assetUrl is inside a comment', () => {
    expect(wrappedInAssetUrl(upTo("const u = /* assetUrl( // note */ '/assets/shark/shark.glb';"))).toBe(false);
  });

  /** An apostrophe in a comment must not put the quote scan into a string. */
  it("rejects a bare path after a comment containing an apostrophe", () => {
    expect(wrappedInAssetUrl(upTo("const u = /* don't wrap it */ '/assets/shark/shark.glb';"))).toBe(false);
  });

  it('rejects something else that merely ends in the same name', () => {
    expect(wrappedInAssetUrl(upTo("window.assetUrl('/assets/shark/shark.glb')"))).toBe(false);
    expect(wrappedInAssetUrl(upTo("notAssetUrl('/assets/shark/shark.glb')"))).toBe(false);
  });
});

describe('bundledRefs', () => {
  /**
   * One case per base Vite accepts, because the shape of the emitted URL is
   * different in each and the first version only recognised the first. Missing
   * them meant finding nothing to check and reporting a pass.
   */
  const entry = (js: string, css: string) =>
    `<script type="module" crossorigin src="${js}"></script><link rel="stylesheet" href="${css}">`;

  it('finds the entry pair at the site root', () => {
    expect(bundledRefs(entry('/assets/index-a.js', '/assets/index-b.css'))).toEqual([
      '/assets/index-a.js',
      '/assets/index-b.css',
    ]);
  });

  it('finds them under a subpath', () => {
    expect(bundledRefs(entry('/voyage/assets/index-a.js', '/voyage/assets/index-b.css'))).toHaveLength(2);
  });

  it('finds them on a CDN, which is where the slash rule found nothing', () => {
    expect(bundledRefs(entry('https://cdn.example.com/v/assets/index-a.js', 'https://cdn.example.com/v/assets/index-b.css')))
      .toHaveLength(2);
  });

  it('finds them in a relative build', () => {
    expect(bundledRefs(entry('./assets/index-a.js', './assets/index-b.css'))).toHaveLength(2);
  });

  /** An unrelated outbound link is not a bundle reference and must not be one. */
  it('ignores a link that does not point into the bundle', () => {
    expect(bundledRefs('<link rel="stylesheet" href="https://fonts.example.com/css2?family=X">')).toEqual([]);
  });

  /**
   * And a page with no bundle at all yields nothing, which is what lets the
   * caller tell "checked and clean" from "there was nothing here".
   */
  it('yields nothing for a page that is not a build', () => {
    expect(bundledRefs('<html><body>hi</body></html>')).toEqual([]);
  });
});
