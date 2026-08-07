import * as THREE from 'three';
import { MAX_WAVES, type WaveField } from '../sim/waves';
import { MAX_ACTIVE_ISLANDS, WAKE_FADE, WAKE_MAX, type Terrain } from '../sim/terrain';
import { EDGE_FADE, type RegionTerrain } from '../sim/region-terrain';
import type { SkyState } from '../sim/sky';
import { compassVec } from '../sim/math';

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
const SIZE = 900;
const SEG = 300; // subdivisions -> 3 m per cell
/**
 * The island window is defined by the physics, not here: the shader has to loop
 * over exactly the islands the boat feels, or the flat water and the flat ride
 * would be in different places.
 */
const MAX_ISLANDS = MAX_ACTIVE_ISLANDS;

/**
 * Depth, in metres, that the field texture's green channel stores as 1.0.
 *
 * Eight bits over 40 m is a 16 cm quantum, which is finer than the shoal shade
 * can show and far finer than a 25 m cell means. Anything deeper than this is
 * simply "deep", which is true of everything the colour is trying to say.
 */
const FIELD_DEPTH = 40;
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

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform vec2 uOrigin;                  // world position of the grid centre (sim coords)
  uniform vec4 uWaveA[${MAX_WAVES}];     // dirX, dirY, k, omega
  uniform vec2 uWaveB[${MAX_WAVES}];     // amp, phase
  uniform vec4 uIslands[${MAX_ISLANDS}]; // x, y, radius, active
  uniform vec2 uDownwind;                // unit vector, the way the wind travels
  uniform float uSteep;
  uniform sampler2D uField;              // r = wave shelter, g = depth
  uniform vec3 uRegion;                  // halfWidth, halfHeight, 1 if a region is loaded

  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vHeight;
  varying float vAmp;
  varying float vSteepness;
  varying float vShelter;

  // Must stay identical to Terrain.waveShelter() in src/sim/terrain.ts,
  // including the taper that ends the wake at WAKE_MAX.
  //
  // The w component carries the landmass: 0 is an empty slot, anything else is
  // the group id plus one. Strongest wake within a landmass, multiplied
  // across landmasses --
  // a coast drawn as eight circles has to shade its lee once, not eight times.
  // Walking the list and closing a group off when the id changes needs the
  // pieces of a landmass to be adjacent, which Terrain's constructor guarantees
  // and terrain.test.ts holds it to; the obvious alternative, an array indexed
  // by group id, is not available in GLSL ES 1.00.
  /**
   * Where the field says a point is, in texture space, or outside 0..1 when
   * there is no region or the point is beyond it.
   *
   * Row 0 of the raster is the *north* edge and v runs the other way, which is
   * the one thing this conversion can get wrong and the reason the land and the
   * flat water would otherwise appear mirrored about the middle of the bay.
   */
  vec2 fieldUv(vec2 p) {
    return vec2(
      (p.x + uRegion.x) / (2.0 * uRegion.x),
      1.0 - (p.y + uRegion.y) / (2.0 * uRegion.y)
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
    float dx = max(0.0, abs(p.x) - uRegion.x);
    float dy = max(0.0, abs(p.y) - uRegion.y);
    return min(1.0, max(dx, dy) / ${EDGE_FADE.toFixed(1)});
  }

  float waveShelter(vec2 p) {
    // A region carries its shelter as data, computed by the same sweep the
    // physics reads -- so this is not a copy of the model, it *is* the model's
    // output. The duplication below survives only for the procedural ocean,
    // where there is no field to sample and the islands are the whole world.
    if (uRegion.z > 0.5) {
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

    float shelter = 1.0;
    float groupMax = 0.0;
    float group = -1.0;
    for (int i = 0; i < ${MAX_ISLANDS}; i++) {
      if (uIslands[i].w < 0.5) continue;
      if (uIslands[i].w != group) {
        shelter *= 1.0 - groupMax;
        groupMax = 0.0;
        group = uIslands[i].w;
      }
      vec2 d = p - uIslands[i].xy;
      float along = dot(d, uDownwind);
      if (along <= 0.0) continue;
      if (along > ${WAKE_MAX.toFixed(1)}) continue;
      float across = abs(d.x * uDownwind.y - d.y * uDownwind.x);
      float halfWidth = uIslands[i].z * 1.15 + along * 0.1;
      if (across > halfWidth) continue;
      float taper = 1.0 - smoothstep(${WAKE_FADE.toFixed(1)}, ${WAKE_MAX.toFixed(1)}, along);
      float decay = exp(-along / (uIslands[i].z * 9.0 + 200.0)) * taper;
      float edge = 1.0 - pow(across / halfWidth, 2.0);
      groupMax = max(groupMax, 0.9 * decay * edge);
    }
    shelter *= 1.0 - groupMax; // the last landmass has no successor to close it
    return max(0.05, shelter);
  }

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

    vec2 disp = p - horiz;
    // sim (x=east, y=north) -> three (x=east, y=up, z=south)
    vec3 pos = vec3(disp.x - uOrigin.x, h, -(disp.y - uOrigin.y));

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
  uniform vec4 uIslands[${MAX_ISLANDS}];
  uniform sampler2D uField;
  uniform vec3 uRegion;

  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vHeight;
  varying float vAmp;
  varying float vSteepness;
  varying float vShelter;

  ${rippleGlsl}

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

    // Shoal water is paler. It is also where you run aground, so this doubles
    // as the only warning the player gets.
    vec2 simP = vec2(vWorld.x, -vWorld.z);
    float shoal = 0.0;
    vec2 fuv = vec2(
      (simP.x + uRegion.x) / (2.0 * uRegion.x),
      1.0 - (simP.y + uRegion.y) / (2.0 * uRegion.y)
    );
    float beyond = 0.0;
    if (uRegion.z > 0.5) {
      float ox = max(0.0, abs(simP.x) - uRegion.x);
      float oy = max(0.0, abs(simP.y) - uRegion.y);
      beyond = min(1.0, max(ox, oy) / ${EDGE_FADE.toFixed(1)});
    }
    if (uRegion.z > 0.5 && beyond < 1.0) {
      // Straight off the surveyed depth, so the pale water is where the water
      // really is shallow rather than where a circle's radius happened to fall.
      // Faded out over the same band as the shelter, so the shoal shading does
      // not run on past the edge of the data that justified it.
      float depth = texture2D(uField, clamp(fuv, 0.0, 1.0)).g * ${FIELD_DEPTH.toFixed(1)};
      shoal = (1.0 - smoothstep(0.0, ${SHOAL_DEPTH.toFixed(1)}, depth)) * (1.0 - beyond);
    } else {
      for (int i = 0; i < ${MAX_ISLANDS}; i++) {
        if (uIslands[i].w < 0.5) continue;
        float d = distance(simP, uIslands[i].xy) - uIslands[i].z;
        shoal = max(shoal, 1.0 - smoothstep(0.0, 110.0, max(d, 0.0)));
      }
    }
    col = mix(col, mix(uShallow, vec3(0.55, 0.62, 0.55), 0.55), shoal * 0.75);

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
 * So a flat plane fills in the rest. It is shaded by the same formula as the
 * grid with a flat normal, which is exactly what the grid itself has out there
 * -- its waves are faded to zero by its own edge -- so the join does not show.
 * It sits a third of a metre lower to stay out of a depth fight with the grid
 * that covers it.
 */
const FAR_SIZE = 8000;
const FAR_Y = -0.35;

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

  // The colour half of the grid's fragment shader, with the swell gone and only
  // the ripple left on the surface. Whitecaps and the shoal tint are left out:
  // both need wave amplitude or nearby land, and neither survives out here.
  void main() {
    float dist = length(cameraPosition - vWorld);
    vec2 rs = rippleSlope(vec2(vWorld.x, -vWorld.z), uTime, rippleAmp(dist, uRipple));
    vec3 n = normalize(vec3(-rs.x, 1.0, rs.y));
    vec3 viewDir = normalize(cameraPosition - vWorld);
    vec3 sunDir = normalize(uSun);

    float diff = max(dot(n, sunDir), 0.0);
    float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);

    vec3 col = mix(uDeep, uShallow, diff * 0.65);
    col = mix(col, uSky, clamp(fres * 0.85, 0.0, 0.75));

    vec3 h = normalize(sunDir + viewDir);
    col += uSunColor * pow(max(dot(n, h), 0.0), 90.0) * uSpecular;

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
  ): void;
  setTerrain(terrain: Terrain): void;
  /**
   * Install a surveyed region, or null for the procedural ocean.
   *
   * While one is installed the shader reads its shelter and its depth out of a
   * texture instead of recomputing the circle model, which is what finally ends
   * the hand-copied GLSL that AGENTS.md names as this project's most-watched
   * hazard -- for a region, at least.
   */
  setRegion(terrain: RegionTerrain | null): void;
  /** Re-upload the shelter channel if the wind has moved the field. */
  updateRegion(twd: number): void;
  /**
   * Where the spreader flood hangs and how lit it is, for the pool it throws.
   * @param height metres above the water; it sets the size of the pool
   */
  setLamp(simX: number, simY: number, level: number, height: number): void;
  dispose(): void;
}

export function createWater(): Water {
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  // The plane stays in XY: the shader converts to three's coordinates itself,
  // so there is no rotation here.

  const waveA: THREE.Vector4[] = [];
  const waveB: THREE.Vector2[] = [];
  for (let i = 0; i < MAX_WAVES; i++) {
    waveA.push(new THREE.Vector4());
    waveB.push(new THREE.Vector2());
  }
  const islands: THREE.Vector4[] = [];
  for (let i = 0; i < MAX_ISLANDS; i++) islands.push(new THREE.Vector4(0, 0, 1, 0));

  const uniforms = {
    uTime: { value: 0 },
    uOrigin: { value: new THREE.Vector2() },
    uWaveA: { value: waveA },
    uWaveB: { value: waveB },
    uIslands: { value: islands },
    uDownwind: { value: new THREE.Vector2(0, -1) },
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
    uField: { value: null as THREE.DataTexture | null },
    // halfWidth, halfHeight, and whether a region is loaded at all.
    uRegion: { value: new THREE.Vector3(1, 1, 0) },
  };

  let region: RegionTerrain | null = null;
  let field: THREE.DataTexture | null = null;
  /** The direction the shelter channel was written for, so it is not rewritten. */
  let fieldTwd: number | null = null;

  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;

  // The same uniform objects, so the far sea cannot fall out of step with the
  // grid it joins: one update() sets the colours for both.
  const farGeo = new THREE.PlaneGeometry(FAR_SIZE, FAR_SIZE);
  farGeo.rotateX(-Math.PI / 2);
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
    setTerrain(terrain) {
      for (let i = 0; i < MAX_ISLANDS; i++) {
        const isl = terrain.islands[i];
        // w is the landmass id plus one, so that zero can still mean "no island
        // here". Uploaded in Terrain's order, which it sorts by landmass --
        // waveShelter() in the shader walks the list and closes a group off at
        // each change, and that is only right while a landmass is contiguous.
        if (isl) islands[i].set(isl.pos.x, isl.pos.y, isl.radius, terrain.landGroup[i] + 1);
        else islands[i].set(0, 0, 1, 0);
      }
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
      const cell = next.region.grid.cell;
      for (let row = 0; row < height; row++) {
        const y = halfH - (row + 0.5) * cell;
        for (let col = 0; col < width; col++) {
          const x = -halfW + (col + 0.5) * cell;
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
      for (let row = 0; row < height; row++) {
        const y = halfH - (row + 0.5) * cell;
        for (let col = 0; col < width; col++) {
          const x = -halfW + (col + 0.5) * cell;
          data[(row * width + col) * 4] = Math.round(
            region.shelter.shelterInputAt(x, y) * 255,
          );
        }
      }
      field.needsUpdate = true;
    },

    update(waves, simX, simY, tws, twd, sky, visibility) {
      // Snap to whole cells, otherwise the vertices slide and the water swims.
      const ox = Math.round(simX / quad) * quad;
      const oy = Math.round(simY / quad) * quad;
      uniforms.uOrigin.value.set(ox, oy);
      mesh.position.set(ox, 0, -oy);
      far.position.set(ox, FAR_Y, -oy);
      uniforms.uTime.value = waves.time;

      const from = compassVec(twd);
      uniforms.uDownwind.value.set(-from.x, -from.y);

      for (let i = 0; i < MAX_WAVES; i++) {
        const c = waves.comps[i];
        if (c) {
          waveA[i].set(c.dirX, c.dirY, c.k, c.omega);
          waveB[i].set(c.amp, c.phase);
        } else {
          waveA[i].set(0, 0, 0, 0);
          waveB[i].set(0, 0);
        }
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
      uniforms.uSun.value.set(sky.sunDir[0], sky.sunDir[1], sky.sunDir[2]);
      // A low sun lays a long glare path down the water; overhead it sparkles.
      uniforms.uSpecular.value = 0.25 + sky.daylight * 0.55 + sky.goldenness * 0.5;
      uniforms.uFogNear.value = visibility * 0.35;
      uniforms.uFogFar.value = visibility;
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
