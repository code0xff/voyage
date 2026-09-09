/**
 * Value noise, shared by every shader that wants a lumpy field.
 *
 * Two functions and nothing else, because that is all two callers agree on.
 * The sky builds an fbm and a domain warp on top of it for clouds; the water
 * uses it flat, for the shape of a patch of foam. Both wanted the same
 * `hash12` and the same bilinear `vnoise`, and the second one nearly got a
 * copy -- which is how a helper loses a correction in this project, and has
 * before.
 *
 * The hash is Dave Hoskins' well-known one. It is not cryptographic and does
 * not need to be: what it has to do is give the same answer for the same
 * lattice point in every shader that samples it, which a copy would eventually
 * stop doing.
 */
export const noiseGlsl = /* glsl */ `
  float hash12(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float e = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, e, f.x), f.y);
  }
`;
