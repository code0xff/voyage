import * as THREE from 'three';
import { MAX_WAVES, type WaveField } from '../sim/waves';

import { EDGE_FADE, type RegionTerrain } from '../sim/region-terrain';
import type { SkyState } from '../sim/sky';
import { smoothstep } from '../sim/math';

/**
 * The wave surface.
 *
 * Vertex displacement happens on the GPU; the height the boat floats at is
 * computed on the CPU. The two must use *literally the same formula* or the
 * boat will not sit on the waves you can see. That is why the wave model is
 * restricted to a sum of sines whose parameters fit in uniforms, and why the
 * GLSL below is a direct transcription of heightAt() in waves.ts.
 *
 * The same applies to land shelter: the shader recomputes waveShelter() from
 * island uniforms rather than approximating it, so the flat water in an
 * island's lee is flat for the boat too.
 *
 * The grid follows the boat but snaps to whole grid cells. Without snapping the
 * vertices slide along the wave form and the water appears to swim.
 */

// m of coverage. Wide enough that race marks stay visible, and small enough
// that the grid corner stays inside QUERY_REACH in terrain.ts -- the shelter
// under the far corner of this grid has to be one the island window can answer.
export const SIZE = 900;
export const SEG = 300; // subdivisions -> 3 m per cell

/**
 * Depth, in metres, that the field texture's green channel stores as 1.0.
 *
 * Eight bits over 40 m is a 16 cm quantum, which is finer than the shoal shade
 * can show and far finer than a 25 m cell means. Anything deeper than this is
 * simply "deep", which is true of everything the colour is trying to say.
 */
export const FIELD_DEPTH = 40;
/** Water shallower than this is shaded pale, m. */
const SHOAL_DEPTH = 12;

/**
 * Fine surface texture, shared by the wave grid and the flat sea beyond it.
 *
 * The wave model is a handful of long sines -- the swell the boat actually
 * rides -- and the grid fades even those out towards its edge. That leaves
 * everything past a couple of hundred metres looking like glass, which is most
 * obvious now that the sea carries on to the horizon instead of stopping.
 *
 * This is a *shading* term and nothing else: it perturbs the normal and never
 * the height. Where the surface is remains waves.ts's answer alone, so the boat
 * still floats on exactly the water it is drawn on -- the same licence the
 * whitecaps already take. Both shaders call this one function so the join
 * between them cannot show.
 *
 * Directions are deliberately non-parallel and the wavelengths are not
 * harmonics, or the sum reads as a repeating grid rather than as water.
 */
const rippleGlsl = /* glsl */ `
  // Returns the ripple's surface slope (d/dx, d/dy) in sim coordinates.
  vec2 rippleSlope(vec2 p, float t, float amp) {
    vec2 s = vec2(0.0);
    // wavelength ~11 m, ~7 m, ~3.7 m; deep-water speed omega = sqrt(g*k)
    vec3 k = vec3(0.55, 0.9, 1.7);
    vec3 a = vec3(0.055, 0.032, 0.014) * amp;
    vec2 d0 = vec2(0.94, 0.34);
    vec2 d1 = vec2(-0.42, 0.91);
    vec2 d2 = vec2(0.71, -0.71);
    s += d0 * (a.x * k.x * cos(k.x * dot(d0, p) - sqrt(9.81 * k.x) * t));
    s += d1 * (a.y * k.y * cos(k.y * dot(d1, p) - sqrt(9.81 * k.y) * t + 1.7));
    s += d2 * (a.z * k.z * cos(k.z * dot(d2, p) - sqrt(9.81 * k.z) * t + 4.1));
    return s;
  }

  // Fade it out before it is finer than a pixel, or the horizon crawls with
  // moire. By then the fog has taken over anyway.
  float rippleAmp(float dist, float scale) {
    return scale * (1.0 - smoothstep(800.0, 2500.0, dist));
  }
`;

/**
 * The uniforms that describe the land, and the two conversions into the
 * field's raster.
 *
 * Split out because three separate things need them -- the wave shelter, the
 * shoal tint, and the vertex displacement that reads the shelter -- and until
 * this existed, `shoalGlsl` carried its own copy of both conversions written
 * out inline. Two copies of a uv flip is exactly the kind of duplication that
 * has bitten this file before: the v axis runs the other way from the raster's
 * rows, and getting it wrong mirrors a bay about its own middle.
 */
// Exported for the tripwire in water.test.ts -- the one consumer besides the
// two shaders that inline it.
export const fieldGlsl = /* glsl */ `
  uniform sampler2D uField;              // r = wave shelter, g = depth
  uniform vec3 uRegion;                  // halfWidth, halfHeight, 1 if loaded
  // Where the field's centre sits in the world -- zero for every surveyed
  // region, and wherever the window was last re-baked for the generated
  // coast. The twin of HeightField.originX/originY, and it must stay one:
  // a shader mapping the texture about the origin while the physics reads
  // it about the boat would shade a lee 20 km from the land that casts it.
  uniform vec2 uRegionOrigin;

  /**
   * Where the field says a point is, in texture space.
   *
   * Row 0 of the raster is the *north* edge and v runs the other way, which is
   * the one thing this conversion can get wrong and the reason the land and the
   * flat water would otherwise appear mirrored about the middle of the bay.
   */
  vec2 fieldUv(vec2 p) {
    vec2 q = p - uRegionOrigin;
    return vec2(
      (q.x + uRegion.x) / (2.0 * uRegion.x),
      1.0 - (q.y + uRegion.y) / (2.0 * uRegion.y)
    );
  }

  /**
   * How far out of the surveyed square a point is, 0..1, matching
   * RegionTerrain.beyond().
   *
   * The band outside the square is the one part of this model that is not
   * shared as data -- there are no texels out there to carry it -- so it is the
   * one part that can diverge, and it did: the shader returned open sea the
   * instant the boundary was crossed while the boat went on feeling the lee for
   * another 800 m. Measured at the north edge in a westerly, 0.35 against 1.0,
   * which is a hard seam on a line drawn on nothing.
   */
  float regionFade(vec2 p) {
    vec2 q = p - uRegionOrigin;
    float dx = max(0.0, abs(q.x) - uRegion.x);
    float dy = max(0.0, abs(q.y) - uRegion.y);
    return min(1.0, max(dx, dy) / ${EDGE_FADE.toFixed(1)});
  }
`;

/**
 * Pale water over a shoal, shared by both sea surfaces.
 *
 * Shared rather than copied, and that is the whole point of it existing as a
 * snippet. It began in the wave grid alone, so the near sea shaded its shallows
 * and the flat sea beyond 450 m never did -- which drew a straight line across
 * an island's pale halo wherever the halo crossed the grid's edge. Two copies
 * would have fixed the line and set up the older failure this file already
 * carries scars from: a formula that agreed in two shaders until one of them
 * was tuned.
 *
 * It declares its own uniforms, so neither shader may declare them again. That
 * is safe because both materials are built on the *same* uniforms object.
 *
 * The depth is read straight off the field texture, so the pale water is
 * where the water really is shallow. There was a second source while the
 * island field existed -- circles, faded out over 110 m from each edge -- and
 * it is exactly the kind of second opinion this file's scars are about.
 */
const shoalGlsl = /* glsl */ `
  float shoalAt(vec2 simP) {
    if (uRegion.z < 0.5) return 0.0;
    float beyond = regionFade(simP);
    if (beyond >= 1.0) return 0.0;
    // Faded out over the same band as the shelter, so the shoal shading does
    // not run on past the edge of the data that justified it.
    float depth = texture2D(uField, clamp(fieldUv(simP), 0.0, 1.0)).g * ${FIELD_DEPTH.toFixed(1)};
    return (1.0 - smoothstep(0.0, ${SHOAL_DEPTH.toFixed(1)}, depth)) * (1.0 - beyond);
  }

  // Shoal water is paler. It is also where you run aground, so this doubles as
  // the only warning the player gets.
  vec3 shoalTint(vec3 col, vec3 shallow, vec2 simP) {
    return mix(col, mix(shallow, vec3(0.55, 0.62, 0.55), 0.55), shoalAt(simP) * 0.75);
  }
`;

/**
 * The flare's pool on the sea, shared by both surfaces.
 *
 * Shared for the same reason shoalTint is: the star hangs a couple of
 * hundred metres up, so its footprint spans several hundred metres of water
 * -- far past the 450 m where the wave grid hands over to the flat sea. The
 * first cut lived in the grid shader alone, and a review pointed out that
 * most of the pool it claimed was being rendered dark by the other surface.
 *
 * It declares its own uniforms, so neither shader may declare them again;
 * both materials are built on the same uniforms object.
 *
 * The construction is the deck lamps' cone-and-fall with the source high
 * instead of at the spreader. The cone is squared and the base kept low
 * because at 230 m of altitude everything in frame is inside the footprint,
 * and the shaping has to come from the curve -- unsquared, the first cut
 * washed the whole visible sea khaki.
 */
const flareGlsl = /* glsl */ `
  uniform vec4 uFlare;      // simX, simY, level (0 dark, ~1.5 in the pop's flash), altitude m
  uniform vec3 uFlareColor;

  vec3 flarePool(vec3 col, vec3 n, vec3 viewDir, vec2 simP, vec3 world) {
    if (uFlare.z <= 0.001) return col;
    float df = distance(simP, uFlare.xy);
    float fh = max(uFlare.w, 10.0);
    float fRadius = fh * 1.6;
    float fCone = 1.0 - smoothstep(fRadius * 0.3, fRadius, df);
    float fFall = (fh * fh) / (df * df + fh * fh);
    vec3 flarePos = vec3(uFlare.x, fh, -uFlare.y);
    vec3 fDir = normalize(flarePos - world);
    vec3 fHalf = normalize(fDir + viewDir);
    float fGlint = pow(max(dot(n, fHalf), 0.0), 40.0);
    return col + uFlareColor * uFlare.z * fCone * fCone * fFall * (0.12 + fGlint * 0.9);
  }
`;

/**
 * How much of the sea's wave energy survives at a point, 0..1.
 *
 * Shared because both surfaces need it now. The grid has always damped its
 * waves and its ripple by the lee -- flat water behind an island is the whole
 * point -- while the flat sea beyond 450 m did not, so a lee that reaches
 * 1500 m downwind changed texture at the grid's rim. That is the same class of
 * seam as the shoal tint, and it wants the same answer: one function, not two.
 *
 * Must stay identical to Terrain.waveShelter() in src/sim/terrain.ts,
 * including the taper that ends the wake at WAKE_MAX.
 *
 * The w component carries the landmass: 0 is an empty slot, anything else is
 * the group id plus one. Strongest wake within a landmass, multiplied across
 * landmasses -- a coast drawn as eight circles has to shade its lee once, not
 * eight times. Walking the list and closing a group off when the id changes
 * needs the pieces of a landmass to be adjacent, which Terrain's constructor
 * guarantees and terrain.test.ts holds it to; the obvious alternative, an array
 * indexed by group id, is not available in GLSL ES 1.00.
 */
const shelterGlsl = /* glsl */ `
  float waveShelter(vec2 p) {
    // A region carries its shelter as data, computed by the same sweep the
    // physics reads -- so this is not a copy of the model, it *is* the model's
    // output. The duplication below survives only for the procedural ocean,
    // where there is no field to sample and the islands are the whole world.
    if (uRegion.z < 0.5) return 1.0;
    float beyond = regionFade(p);
    if (beyond >= 1.0) return 1.0;
    // Clamped, so a point in the fade band reads the edge of the field --
    // which is what RegionTerrain does, its sampler clamping the same way.
    vec2 uv = clamp(fieldUv(p), 0.0, 1.0);
    // The texture carries capped fetch, not shelter, so the root is taken
    // here -- see ShelterField.shelterInputAt. Storing shelter would have the
    // hardware interpolate a square root while the physics takes the root of
    // an interpolation, which are not the same number.
    float inside = max(0.05, sqrt(texture2D(uField, uv).r));
    return inside + (1.0 - inside) * beyond;
  }
`;

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform vec2 uOrigin;                  // world position of the grid centre (sim coords)
  uniform vec4 uWaveA[${MAX_WAVES}];     // dirX, dirY, k, omega
  uniform vec2 uWaveB[${MAX_WAVES}];     // amp, phase
  uniform float uSteep;

  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vHeight;
  varying float vAmp;
  varying float vSteepness;
  varying float vShelter;

  ${fieldGlsl}
  ${shelterGlsl}

  void main() {
    // The plane is built in XY, so local xy is the east/north offset directly.
    vec2 p = position.xy + uOrigin;

    // Fade the wave height to zero at the edge of the grid. Without this the
    // boundary between rippled and flat water shows up as a hard line; fading
    // makes the edge flatten out and blend into the fogged horizon.
    float edge = max(abs(position.x), abs(position.y)) / ${SIZE.toFixed(1)};
    float shelter = waveShelter(p);
    float fade = (1.0 - smoothstep(0.28, 0.49, edge)) * shelter;

    float h = 0.0;
    float dhdx = 0.0;
    float dhdy = 0.0;
    vec2 horiz = vec2(0.0);
    float ampSum = 0.0;

    for (int i = 0; i < ${MAX_WAVES}; i++) {
      vec2 d = uWaveA[i].xy;
      float k = uWaveA[i].z;
      float w = uWaveA[i].w;
      float a = uWaveB[i].x;
      float ph = uWaveB[i].y;
      if (a <= 0.0) continue;

      float av = a * fade;
      float theta = k * dot(d, p) - w * uTime + ph;
      float s = sin(theta);
      float c = cos(theta);
      h += av * s;
      dhdx += av * k * d.x * c;
      dhdy += av * k * d.y * c;
      // Gerstner horizontal displacement: sharpens crests, flattens troughs
      horiz += d * (uSteep * av * c);
      ampSum += av;
    }

    // sim (x=east, y=north) -> three (x=east, y=up, z=south)
    //
    // Built from the local position rather than by subtracting uOrigin back
    // off p. The two are the same algebraically, and in float they are the same
    // only because the origin is snapped to whole cells and integers under 2^24
    // are exact -- a guarantee that lives in update() for an unrelated reason
    // and would take this with it if it ever moved. The rim has to land on
    // exactly the square the far sea's hole is cut to, so it does not borrow.
    vec3 pos = vec3(position.x - horiz.x, h, -(position.y - horiz.y));

    // Normal. three.z = -sim.y, so the z component flips sign.
    vNormal = normalize(vec3(-dhdx, 1.0, dhdy));
    vHeight = h;
    vAmp = ampSum;
    vSteepness = length(vec2(dhdx, dhdy));
    vShelter = shelter;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vWorld = (modelMatrix * vec4(pos, 1.0)).xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSky;
  uniform vec3 uSun;
  uniform vec3 uSunColor;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uWhitecap;
  uniform float uSpecular;
  uniform float uRipple;
  uniform vec4 uLamp;
  uniform vec3 uLampColor;

  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vHeight;
  varying float vAmp;
  varying float vSteepness;
  varying float vShelter;

  ${rippleGlsl}
  ${fieldGlsl}
  ${shoalGlsl}
  ${flareGlsl}

  void main() {
    float dist = length(cameraPosition - vWorld);
    // Sheltered water is smooth: the lee of an island loses the ripple for the
    // same reason it loses the waves.
    vec2 rs = rippleSlope(
      vec2(vWorld.x, -vWorld.z),
      uTime,
      rippleAmp(dist, uRipple) * vShelter
    );
    // three.z = -sim.y, so the z slope flips sign, exactly as in the vertex
    // shader's normal above.
    vec3 n = normalize(normalize(vNormal) + vec3(-rs.x, 0.0, rs.y));
    vec3 viewDir = normalize(cameraPosition - vWorld);
    vec3 sunDir = normalize(uSun);

    float diff = max(dot(n, sunDir), 0.0);
    // Fresnel: grazing angles reflect more sky. This is what reads as water.
    float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);

    vec3 col = mix(uDeep, uShallow, diff * 0.65);

    vec2 simP = vec2(vWorld.x, -vWorld.z);
    col = shoalTint(col, uShallow, simP);

    col = mix(col, uSky, clamp(fres * 0.85, 0.0, 0.75));

    vec3 h = normalize(sunDir + viewDir);
    col += uSunColor * pow(max(dot(n, h), 0.0), 90.0) * uSpecular;

    // Whitecaps. Keying on height alone produces broad white bands that read
    // as fog. Waves only actually break on crests that are both high *and*
    // steep, so require both. Sheltered water does not break at all.
    if (vAmp > 0.001) {
      float crest = smoothstep(0.72, 0.99, vHeight / vAmp);
      float steep = smoothstep(0.22, 0.55, vSteepness);
      col = mix(col, vec3(0.86, 0.91, 0.95), crest * steep * uWhitecap * vShelter);
    }

    // Deck lights pooling on the sea.
    //
    // The lamps themselves are three.js PointLights, and PointLights do nothing
    // here: this is a raw ShaderMaterial and it takes no scene lighting at all.
    // Left to them the boat was a lit object floating on black water, which is
    // the one thing that gives away that the sea is a shader and not a sea.
    //
    // So the pool is drawn explicitly. It is added *before* the fog so that a
    // boat seen from the far end of a long chase camera loses her pool the same
    // way she loses her hull.
    //
    // It is a *cone from the spreader*, not a smear centred on the boat. That
    // distinction is the whole difference between something that looks like a
    // light and something that looks like a stain: a lamp hung up the mast
    // throws a round patch with an edge to it, and the edge is what the eye
    // reads as illumination. uLamp.w carries the height the lamp is actually
    // hanging at, taken off the scene graph, so when she heels and the lamp
    // swings out to leeward the pool goes with it.
    if (uLamp.z > 0.001) {
      float dl = distance(simP, uLamp.xy);
      float h = max(uLamp.w, 1.0);

      // The cone's footprint. A wide-ish flood, and the soft inner edge keeps
      // the rim from looking stamped on.
      float radius = h * 1.15;
      float cone = 1.0 - smoothstep(radius * 0.45, radius, dl);
      // Inverse square from the lamp itself, which is what makes the middle of
      // the pool brighter than its edge without any extra tuning.
      float fall = (h * h) / (dl * dl + h * h);
      float pool = cone * fall;

      // The wash alone is still a flat disc. What makes it read as light *on
      // water* is the glitter: a specular off the ripple normals, with the lamp
      // treated as the near source it is rather than as one at infinity like
      // the sun. Broad exponent, because a soft flood throws a soft highlight
      // and not a sun-glint pinpoint.
      vec3 lampPos = vec3(uLamp.x, h, -uLamp.y);
      vec3 lampDir = normalize(lampPos - vWorld);
      vec3 lh = normalize(lampDir + viewDir);
      float glint = pow(max(dot(n, lh), 0.0), 45.0);

      col += uLampColor * uLamp.z * pool * (0.8 + glint * 2.4);
    }

    // The flare's pool, shared with the flat sea beyond the grid -- see
    // flareGlsl for why it cannot live in one shader alone.
    col = flarePool(col, n, viewDir, simP, vWorld);

    col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, dist));

    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * The sea beyond the wave grid.
 *
 * The detailed grid is 900 m across, which is all the resolution the waves are
 * worth. Everything outside it used to be nothing at all -- what looked like
 * the horizon was the edge of the grid, and any land drawn past it hung in the
 * sky with its underwater skirt showing. That was survivable when islands were
 * only ever a few hundred metres away; in an endless ocean, where land is drawn
 * out to the fog, it makes every island look like it is floating.
 *
 * So a flat sea fills in the rest. It is shaded by the same formulae as the
 * grid with a flat normal, which is exactly what the grid itself has out there
 * -- its waves are faded to zero by its own edge -- so the join does not show.
 *
 * A ring, and at exactly the grid's own height. It was a full plane a third of
 * a metre lower, which kept it out of a depth fight with the grid covering it
 * and cost far more than it bought: a 35 cm step in a square ring 450 m from
 * the boat, following her about. From a deck-height eye that lip hides some
 * eighty metres of sea behind it, and what it reads as is water pooled on top
 * of the water -- you sail in a raised basin. Animals crossing it dropped the
 * same 35 cm, and whales are seeded 220-560 m out, so they crossed it often.
 *
 * Cutting the hole removes the overlap instead of hiding it, which is what
 * makes it safe to put both surfaces on y = 0: there is no depth fight to lose
 * when nothing is drawn twice. The seam is exact rather than merely close --
 * the grid's fade reaches zero before its rim, so the outer nine metres of it
 * carry no wave height and no Gerstner displacement at all, and the rim lands
 * on exactly the square this hole is cut to.
 */
const FAR_SIZE = 8000;

const farVertexShader = /* glsl */ `
  varying vec3 vWorld;

  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const farFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSky;
  uniform vec3 uSun;
  uniform vec3 uSunColor;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uSpecular;
  uniform float uRipple;

  varying vec3 vWorld;

  ${rippleGlsl}
  ${fieldGlsl}
  ${shoalGlsl}
  ${flareGlsl}
  ${shelterGlsl}

  // The colour half of the grid's fragment shader, with the swell gone and only
  // the ripple left on the surface.
  //
  // Whitecaps are left out and the shoal tint is not, which is the difference
  // between a term that cannot reach the join and one that can. Breaking needs
  // wave amplitude, and the grid has faded its own to zero by the time it meets
  // this plane, so there is nothing on either side to disagree about. Shallow
  // water needs only land, and land sits either side of the join all the time.
  void main() {
    float dist = length(cameraPosition - vWorld);
    vec2 simP = vec2(vWorld.x, -vWorld.z);
    // Damped by the lee, exactly as the grid damps its own ripple by vShelter.
    // Without it a lee reaching 1500 m downwind changed texture at the grid's
    // rim: smooth inside, rippled outside, on a straight line.
    //
    // Guarded on the amplitude rather than computed always. The ripple is gone
    // by 2500 m from the eye anyway, and beyond that this would be a sixteen
    // island loop per fragment for a number about to be multiplied by zero.
    float amp = rippleAmp(dist, uRipple);
    if (amp > 0.0) amp *= waveShelter(simP);
    vec2 rs = rippleSlope(simP, uTime, amp);
    vec3 n = normalize(vec3(-rs.x, 1.0, rs.y));
    vec3 viewDir = normalize(cameraPosition - vWorld);
    vec3 sunDir = normalize(uSun);

    float diff = max(dot(n, sunDir), 0.0);
    float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);

    vec3 col = mix(uDeep, uShallow, diff * 0.65);
    // Before the sky and the sun, in the grid's order. Applied after them it is
    // the same tint over a different base, which is a join by another name.
    col = shoalTint(col, uShallow, simP);
    col = mix(col, uSky, clamp(fres * 0.85, 0.0, 0.75));

    vec3 h = normalize(sunDir + viewDir);
    col += uSunColor * pow(max(dot(n, h), 0.0), 90.0) * uSpecular;

    // The flare's pool, before the fog for the lamp's reason: lost with
    // distance the way everything on the water is.
    col = flarePool(col, n, viewDir, simP, vWorld);

    col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, dist));

    gl_FragColor = vec4(col, 1.0);
  }
`;

export interface Water {
  mesh: THREE.Mesh;
  /** The flat sea filling everything outside the grid, out to the fog. */
  far: THREE.Mesh;
  /** Per frame: move the grid to the boat and refresh the wave uniforms. */
  update(
    waves: WaveField,
    simX: number,
    simY: number,
    tws: number,
    twd: number,
    sky: SkyState,
    visibility: number,
    /** The scene's flash lift, 0 with nothing burning; see scene.ts. */
    flareLift: number,
    /** What that flash warms the sea toward -- amber for a flare, blue for a bolt. */
    flashColor: THREE.Color,
  ): void;
  /**
   * Install the land, or null before the first window is built.
   *
   * While one is installed the shader reads its shelter and its depth out of a
   * texture instead of recomputing the circle model, which is what finally ends
   * the hand-copied GLSL that AGENTS.md names as this project's most-watched
   * hazard -- for a region, at least.
   */
  setRegion(terrain: RegionTerrain | null): void;
  /** Re-upload the shelter channel if the wind has moved the field. */
  updateRegion(twd: number): void;
  /** Height of the rendered water surface at a world point. */
  surfaceHeight(x: number, y: number, waves: WaveField): number;
  /**
   * Where the spreader flood hangs and how lit it is, for the pool it throws.
   * @param height metres above the water; it sets the size of the pool
   */
  setLamp(simX: number, simY: number, level: number, height: number): void;
  /** The flare's pool, same contract as the lamp: level 0 puts it out. */
  setFlare(simX: number, simY: number, level: number, altitude: number): void;
  dispose(): void;
}

/**
 * A square annulus in the XZ plane: everything between `inner` and `outer`
 * half-extents, with a hole in the middle.
 *
 * Built by hand rather than by punching a hole with `THREE.Shape`, which would
 * run a general triangulator over it and give up the property the whole thing
 * exists for: the hole's edge has to be the exact numbers the grid's rim lands
 * on, and it has to carry a vertex at every one of them.
 *
 * That second half is why `seg` is here. The grid's rim is 301 vertices a side;
 * an inner edge of two would meet it in a row of T-junctions, where a vertex on
 * one surface sits partway along an edge of the other. The lines agree
 * mathematically and the rasteriser still need not, because it snaps vertices
 * to a fixed-point grid and a long edge and a chain of short ones can land on
 * different pixels -- which shows as a dotted line of pinholes exactly where
 * this join must not show. Subdivided to match, there are no T-junctions and
 * every edge is shared end to end.
 *
 * Four bands for the shared sides and four quads for the corners. About 2400
 * triangles, which is nothing: the far sea's shading is entirely per-fragment,
 * so the only reason for any of these vertices is the seam.
 */
export function ringGeometry(inner: number, outer: number, seg: number): THREE.BufferGeometry {
  const pos: number[] = [];
  // Wound to face +Y, which is what `PlaneGeometry` rotated onto the XZ plane
  // does and what the material's default FrontSide needs. Wound the other way
  // the sea is simply not there when you look down at it. Callers must pass
  // x1 > x0 and z1 > z0.
  const quad = (x0: number, z0: number, x1: number, z1: number) => {
    pos.push(x0, 0, z0, x1, 0, z1, x1, 0, z0);
    pos.push(x0, 0, z0, x0, 0, z1, x1, 0, z1);
  };
  const step = (2 * inner) / seg;
  for (let i = 0; i < seg; i++) {
    const a0 = -inner + i * step;
    const a1 = a0 + step;
    quad(a0, -outer, a1, -inner); // north
    quad(a0, inner, a1, outer); // south
    quad(-outer, a0, -inner, a1); // west
    quad(inner, a0, outer, a1); // east
  }
  quad(-outer, -outer, -inner, -inner);
  quad(inner, -outer, outer, -inner);
  quad(-outer, inner, -inner, outer);
  quad(inner, inner, outer, outer);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return geo;
}

export function createWater(): Water {
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  // The plane stays in XY: the shader converts to three's coordinates itself,
  // so there is no rotation here.

  const waveA: THREE.Vector4[] = [];
  const waveB: THREE.Vector2[] = [];
  /** Reused every frame; `packUniform` fills it. */
  const packed = new Float32Array(MAX_WAVES * 6);
  for (let i = 0; i < MAX_WAVES; i++) {
    waveA.push(new THREE.Vector4());
    waveB.push(new THREE.Vector2());
  }
  const uniforms = {
    uTime: { value: 0 },
    uOrigin: { value: new THREE.Vector2() },
    uWaveA: { value: waveA },
    uWaveB: { value: waveB },
    uSteep: { value: 0.55 },
    uDeep: { value: new THREE.Color(0x17293b) },
    uShallow: { value: new THREE.Color(0x3a6b8a) },
    uSky: { value: new THREE.Color(0x62869f) },
    uSun: { value: new THREE.Vector3(-0.5, 0.7, 0.3) },
    uSunColor: { value: new THREE.Color(1, 0.98, 0.94) },
    uFogColor: { value: new THREE.Color(0x1b2a3a) },
    uFogNear: { value: 260 },
    uFogFar: { value: 560 },
    uWhitecap: { value: 0 },
    uSpecular: { value: 0.5 },
    uRipple: { value: 1 },
    // xy: the lamp in sim coordinates, z: how lit it is, w: its height.
    uLamp: { value: new THREE.Vector4(0, 0, 0, 1) },
    uLampColor: { value: new THREE.Color(0.42, 0.29, 0.14) },
    uFlare: { value: new THREE.Vector4(0, 0, 0, 1) },
    uFlareColor: { value: new THREE.Color(0.6, 0.46, 0.3) },
    uField: { value: null as THREE.DataTexture | null },
    // halfWidth, halfHeight, and whether a region is loaded at all.
    uRegion: { value: new THREE.Vector3(1, 1, 0) },
    uRegionOrigin: { value: new THREE.Vector2(0, 0) },
  };

  let region: RegionTerrain | null = null;
  let field: THREE.DataTexture | null = null;
  /** The direction the shelter channel was written for, so it is not rewritten. */
  let fieldTwd: number | null = null;
  let originX = 0;
  let originY = 0;
  let currentTwd = 0;

  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;

  // The same uniform objects, so the far sea cannot fall out of step with the
  // grid it joins: one update() sets the colours for both.
  // Same subdivision as the grid along the shared edge, so the two meet
  // vertex for vertex and leave no T-junction to crack.
  const farGeo = ringGeometry(SIZE / 2, FAR_SIZE / 2, SEG);
  const farMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: farVertexShader,
    fragmentShader: farFragmentShader,
  });
  const far = new THREE.Mesh(farGeo, farMat);
  far.frustumCulled = false;
  far.renderOrder = -2;

  const quad = SIZE / SEG;

  return {
    mesh,
    far,
    setLamp(simX, simY, level, height) {
      uniforms.uLamp.value.set(simX, simY, level, height);
    },
    setFlare(simX, simY, level, altitude) {
      uniforms.uFlare.value.set(simX, simY, level, altitude);
    },
    setRegion(next) {
      region = next;
      if (field) {
        field.dispose();
        field = null;
        uniforms.uField.value = null;
      }
      if (!next) {
        uniforms.uRegion.value.set(1, 1, 0);
        uniforms.uRegionOrigin.value.set(0, 0);
        return;
      }

      const { width, height } = next.region.grid;
      // One RGBA texture rather than two: the depth never changes and the
      // shelter changes with the wind, but they are the same grid and sampled
      // at the same instant, and a single fetch in the fragment shader is
      // cheaper than two.
      const data = new Uint8Array(width * height * 4);
      const halfW = next.height.halfWidth;
      const halfH = next.height.halfHeight;
      const ox = next.height.originX;
      const oy = next.height.originY;
      const cell = next.region.grid.cell;
      for (let row = 0; row < height; row++) {
        const y = oy + halfH - (row + 0.5) * cell;
        for (let col = 0; col < width; col++) {
          const x = ox - halfW + (col + 0.5) * cell;
          // Depth is baked once here. Read through the terrain rather than the
          // raster so that it is the depth the keel will find, edge fade and
          // all, and not the raw survey.
          const depth = Math.max(0, next.depthAt(x, y));
          data[(row * width + col) * 4 + 1] = Math.round(
            Math.min(1, depth / FIELD_DEPTH) * 255,
          );
        }
      }
      field = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
      // Linear, because the shelter it carries is a smooth field and nearest
      // sampling would show the 25 m grid as facets in the flat water.
      field.magFilter = THREE.LinearFilter;
      field.minFilter = THREE.LinearFilter;
      field.wrapS = THREE.ClampToEdgeWrapping;
      field.wrapT = THREE.ClampToEdgeWrapping;
      field.needsUpdate = true;
      uniforms.uField.value = field;
      uniforms.uRegion.value.set(halfW, halfH, 1);
      uniforms.uRegionOrigin.value.set(ox, oy);
      fieldTwd = null;
    },

    updateRegion(twd) {
      if (!region || !field) return;
      // The physics rebuilds the sweep lazily when it is asked; asking here is
      // what keeps the texture in step with it. Both go through the same
      // ShelterField, so there is no second implementation to diverge -- which
      // was the entire point of the exercise.
      region.shelter.update(twd);
      if (fieldTwd === twd) return;
      fieldTwd = twd;

      const { width, height, cell } = region.region.grid;
      const data = field.image.data as Uint8Array;
      const halfW = region.height.halfWidth;
      const halfH = region.height.halfHeight;
      const ox = region.height.originX;
      const oy = region.height.originY;
      for (let row = 0; row < height; row++) {
        const y = oy + halfH - (row + 0.5) * cell;
        for (let col = 0; col < width; col++) {
          const x = ox - halfW + (col + 0.5) * cell;
          data[(row * width + col) * 4] = Math.round(
            region.shelter.shelterInputAt(x, y) * 255,
          );
        }
      }
      field.needsUpdate = true;
    },

    update(waves, simX, simY, tws, twd, sky, visibility, flareLift, flashColor) {
      // Snap to whole cells, otherwise the vertices slide and the water swims.
      const ox = Math.round(simX / quad) * quad;
      const oy = Math.round(simY / quad) * quad;
      originX = ox;
      originY = oy;
      currentTwd = twd;
      uniforms.uOrigin.value.set(ox, oy);
      mesh.position.set(ox, 0, -oy);
      // Same height and same origin, so the ring's hole sits exactly on the
      // grid it is cut for.
      far.position.set(ox, 0, -oy);
      uniforms.uTime.value = waves.time;

      // Through `packUniform` rather than reading the components field by
      // field. It is the one path `waves.test.ts` checks the surface against,
      // so what the shader is handed is what the test asserts floats the boat;
      // copying `phase` here instead would drop the water's drift and nothing
      // would have caught it.
      waves.packUniform(packed);
      for (let i = 0; i < MAX_WAVES; i++) {
        const o = i * 6;
        waveA[i].set(packed[o], packed[o + 1], packed[o + 2], packed[o + 3]);
        waveB[i].set(packed[o + 4], packed[o + 5]);
      }

      // Whitecaps start to appear around 12 knots.
      uniforms.uWhitecap.value = Math.min(Math.max((tws - 6) / 12, 0), 0.85);
      // Ripple with the wind. A glassy calm is a real thing and should look
      // like one, but the sea should never be a mirror once it is blowing.
      uniforms.uRipple.value = Math.min(0.3 + tws / 9, 1.5);

      uniforms.uDeep.value.setRGB(sky.waterDeep[0], sky.waterDeep[1], sky.waterDeep[2]);
      uniforms.uShallow.value.setRGB(
        sky.waterShallow[0],
        sky.waterShallow[1],
        sky.waterShallow[2],
      );
      uniforms.uSky.value.setRGB(sky.skyHorizon[0], sky.skyHorizon[1], sky.skyHorizon[2]);
      uniforms.uSunColor.value.setRGB(sky.sunColor[0], sky.sunColor[1], sky.sunColor[2]);
      uniforms.uFogColor.value.setRGB(sky.fogColor[0], sky.fogColor[1], sky.fogColor[2]);
      // The flare warms the sea's own palette, not only its explicit pool: a
      // review traced the scene-level fog warm and found it never reached
      // these shaders, which re-read the sky's colours every frame -- so the
      // "whole night lifts" claim held for the hull and land and quietly
      // failed for the water and the fog it dissolves into. Same constant and
      // coefficients as the scene fog, so land and sea dissolve into the
      // same warmed haze.
      if (flareLift > 0.001) {
        const warm = Math.min(0.5, flareLift * 0.3);
        uniforms.uFogColor.value.lerp(flashColor, warm);
        uniforms.uSky.value.lerp(flashColor, warm * 0.8);
        uniforms.uDeep.value.lerp(flashColor, warm * 0.5);
        uniforms.uShallow.value.lerp(flashColor, warm * 0.5);
      }
      uniforms.uSun.value.set(sky.sunDir[0], sky.sunDir[1], sky.sunDir[2]);
      // A low sun lays a long glare path down the water; overhead it sparkles.
      uniforms.uSpecular.value = 0.25 + sky.daylight * 0.55 + sky.goldenness * 0.5;
      uniforms.uFogNear.value = visibility * 0.35;
      uniforms.uFogFar.value = visibility;
    },
    surfaceHeight(x, y, waves) {
      // Exactly the vertex shader's edge and fade, on the same local
      // coordinates: `position` there is the offset from uOrigin, which is what
      // this subtraction gives. Anything drawn on the water reads its height
      // from here for the same reason the boat reads it from waves.heightAt --
      // a whale sitting on water that is not the water it is drawn on is the
      // kind of divergence this shader's comments exist to prevent.
      const dx = Math.abs(x - originX);
      const dy = Math.abs(y - originY);
      const edge = Math.max(dx, dy) / SIZE;
      const shelter = region ? region.waveShelter(x, y, currentTwd) : 1;
      const fade = (1 - smoothstep(0.28, 0.49, edge)) * shelter;

      // No case for "beyond the grid" any more, and that is the point rather
      // than an oversight. The far sea is at the grid's own height now, and
      // `fade` has already reached zero by edge 0.4897, so this returns 0 out
      // there on its own. The branch this replaces existed only to step down to
      // a plane that was deliberately sunk, and it had already been wrong once:
      // it tested the rim at 0.5 while the fade ended at 0.4897, leaving a 9 m
      // band where the water was drawn at 0 and this answered -0.35.
      return waves.heightAt(x, y) * fade;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      farGeo.dispose();
      farMat.dispose();
      field?.dispose();
    },
  };
}
