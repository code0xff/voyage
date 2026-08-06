import * as THREE from 'three';
import { MAX_WAVES, type WaveField } from '../sim/waves';
import type { Terrain } from '../sim/terrain';
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

const SIZE = 900; // m of coverage. Wide enough that race marks stay visible.
const SEG = 300; // subdivisions -> 3 m per cell
export const MAX_ISLANDS = 10;

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform vec2 uOrigin;                  // world position of the grid centre (sim coords)
  uniform vec4 uWaveA[${MAX_WAVES}];     // dirX, dirY, k, omega
  uniform vec2 uWaveB[${MAX_WAVES}];     // amp, phase
  uniform vec4 uIslands[${MAX_ISLANDS}]; // x, y, radius, active
  uniform vec2 uDownwind;                // unit vector, the way the wind travels
  uniform float uSteep;

  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vHeight;
  varying float vAmp;
  varying float vSteepness;
  varying float vShelter;

  // Must stay identical to Terrain.waveShelter() in src/sim/terrain.ts.
  float waveShelter(vec2 p) {
    float shelter = 1.0;
    for (int i = 0; i < ${MAX_ISLANDS}; i++) {
      if (uIslands[i].w < 0.5) continue;
      vec2 d = p - uIslands[i].xy;
      float along = dot(d, uDownwind);
      if (along <= 0.0) continue;
      float across = abs(d.x * uDownwind.y - d.y * uDownwind.x);
      float halfWidth = uIslands[i].z * 1.15 + along * 0.1;
      if (across > halfWidth) continue;
      float decay = exp(-along / (uIslands[i].z * 9.0 + 200.0));
      float edge = 1.0 - pow(across / halfWidth, 2.0);
      shelter *= 1.0 - 0.9 * decay * edge;
    }
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
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSky;
  uniform vec3 uSun;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uWhitecap;
  uniform float uSpecular;
  uniform vec4 uIslands[${MAX_ISLANDS}];

  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vHeight;
  varying float vAmp;
  varying float vSteepness;
  varying float vShelter;

  void main() {
    vec3 n = normalize(vNormal);
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
    for (int i = 0; i < ${MAX_ISLANDS}; i++) {
      if (uIslands[i].w < 0.5) continue;
      float d = distance(simP, uIslands[i].xy) - uIslands[i].z;
      shoal = max(shoal, 1.0 - smoothstep(0.0, 110.0, max(d, 0.0)));
    }
    col = mix(col, mix(uShallow, vec3(0.55, 0.62, 0.55), 0.55), shoal * 0.75);

    col = mix(col, uSky, clamp(fres * 0.85, 0.0, 0.75));

    vec3 h = normalize(sunDir + viewDir);
    col += vec3(1.0, 0.98, 0.92) * pow(max(dot(n, h), 0.0), 90.0) * uSpecular;

    // Whitecaps. Keying on height alone produces broad white bands that read
    // as fog. Waves only actually break on crests that are both high *and*
    // steep, so require both. Sheltered water does not break at all.
    if (vAmp > 0.001) {
      float crest = smoothstep(0.72, 0.99, vHeight / vAmp);
      float steep = smoothstep(0.22, 0.55, vSteepness);
      col = mix(col, vec3(0.86, 0.91, 0.95), crest * steep * uWhitecap * vShelter);
    }

    float d = length(cameraPosition - vWorld);
    col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, d));

    gl_FragColor = vec4(col, 1.0);
  }
`;

export interface Water {
  mesh: THREE.Mesh;
  /** Per frame: move the grid to the boat and refresh the wave uniforms. */
  update(waves: WaveField, simX: number, simY: number, tws: number, twd: number): void;
  setTerrain(terrain: Terrain): void;
  dispose(): void;
}

export function createWater(fogColor: number, fogNear: number, fogFar: number): Water {
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
    uFogColor: { value: new THREE.Color(fogColor) },
    uFogNear: { value: fogNear },
    uFogFar: { value: fogFar },
    uWhitecap: { value: 0 },
    uSpecular: { value: 0.5 },
  };

  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;

  const quad = SIZE / SEG;

  return {
    mesh,
    setTerrain(terrain) {
      for (let i = 0; i < MAX_ISLANDS; i++) {
        const isl = terrain.islands[i];
        if (isl) islands[i].set(isl.pos.x, isl.pos.y, isl.radius, 1);
        else islands[i].set(0, 0, 1, 0);
      }
    },
    update(waves, simX, simY, tws, twd) {
      // Snap to whole cells, otherwise the vertices slide and the water swims.
      const ox = Math.round(simX / quad) * quad;
      const oy = Math.round(simY / quad) * quad;
      uniforms.uOrigin.value.set(ox, oy);
      mesh.position.set(ox, 0, -oy);
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

    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
