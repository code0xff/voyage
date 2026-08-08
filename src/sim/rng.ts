/**
 * The seeded pseudo-random stream the world is built from.
 *
 * xorshift32 is the generator this project already used in three places, and it
 * is a good one once it is running. Its problem is the *first* number: the
 * state after one round still carries most of the seed's high bits, so two
 * nearby seeds return very nearly the same first draw --
 *
 *     seed 1 -> 0.3104   seed 2 -> 0.3104   seed 3 -> 0.3103   seed 7 -> 0.3101
 *
 * That is invisible to a stream that has to warm up before anything is decided,
 * which is why it went unnoticed. It is not invisible to anything that draws
 * once and immediately shows the player the answer: with the raw generator the
 * first whale surfaced 10.5 s into the passage in *every* world, whatever seed
 * it had been given, because the delay is `8 + first() * 8`.
 *
 * Stirring the seed through splitmix32's finaliser first costs three multiplies
 * once per stream and removes the whole class of it -- seeds 1 and 2 now start
 * from unrelated states rather than adjacent ones. The generator itself is
 * unchanged, so the sequence is still exactly reproducible from a seed, which
 * is the property everything here actually depends on.
 *
 * Note that `Terrain` keeps its own LCG deliberately: changing it would move
 * every island in every existing seed, and the archipelago has measured claims
 * in the README resting on it.
 */
export function rng(seed: number): () => number {
  // splitmix32's finaliser: an avalanche, so one changed input bit changes
  // about half the output bits. Zero is the one state xorshift cannot leave.
  let s = seed >>> 0;
  s = Math.imul(s ^ (s >>> 16), 0x21f0aaad) >>> 0;
  s = Math.imul(s ^ (s >>> 15), 0x735a2d97) >>> 0;
  s = ((s ^ (s >>> 15)) >>> 0) || 1;

  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
