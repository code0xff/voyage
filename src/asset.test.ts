import { describe, expect, it } from 'vitest';
import { joinBase } from './asset';

/**
 * The join, exercised against bases the test runner will never be built with.
 *
 * `import.meta.env.BASE_URL` is `/` under Vitest, and `/` is precisely the base
 * under which getting this wrong is invisible: every string comes back
 * unchanged whether the code prepends the base or forgets to. So the function
 * that does the work takes the base as an argument and is asserted at a
 * subpath, which is where a deployment actually breaks.
 */
describe('joinBase', () => {
  it('leaves a root-served path as it was written', () => {
    expect(joinBase('/', '/assets/whale/humpback-whale.glb')).toBe('/assets/whale/humpback-whale.glb');
  });

  it('puts a subpath in front without doubling the separator', () => {
    expect(joinBase('/voyage/', '/terrain/solent.bin')).toBe('/voyage/terrain/solent.bin');
  });

  /** Vite always hands over a trailing slash, but nothing here relies on it. */
  it('supplies the separator when the base lacks one', () => {
    expect(joinBase('/voyage', '/terrain/solent.bin')).toBe('/voyage/terrain/solent.bin');
  });

  it('carries an absolute base, which is what a CDN deploy sets', () => {
    expect(joinBase('https://cdn.example.com/voyage/', '/assets/gull/seagulls.glb'))
      .toBe('https://cdn.example.com/voyage/assets/gull/seagulls.glb');
  });
});
