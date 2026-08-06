import * as THREE from 'three';
import type { SkyState } from '../sim/sky';

/**
 * Sky dome.
 *
 * A flat background colour is fine at noon and terrible at every other hour:
 * dawn and dusk are almost entirely about the vertical gradient and the glow
 * sitting on the horizon where the sun is. This is a single inverted sphere
 * with a two-stop gradient plus a sun glow, which is all that is needed for a
 * sea horizon where nothing else is visible anyway.
 *
 * Cloud cover flattens the gradient rather than drawing clouds -- an overcast
 * sky really is a featureless grey lid, and faking cumulus badly would look
 * worse than not having any.
 */

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    // Translation only: the dome rides with the camera and never scales.
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uCloud;
  uniform float uDaylight;

  varying vec3 vDir;

  void main() {
    vec3 d = normalize(vDir);
    // Height above the horizon, 0..1, biased so the gradient stacks near it.
    float h = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uTop, pow(h, 0.42));

    // Sun glow. Wide and warm near the horizon, tight and bright when high.
    float cosA = max(dot(d, normalize(uSunDir)), 0.0);
    float tight = pow(cosA, 220.0);
    float halo = pow(cosA, 5.0);
    col += uSunColor * (tight * 1.4 + halo * 0.28 * (0.35 + uDaylight));

    // Overcast flattens everything towards a single grey lid.
    vec3 lid = mix(uHorizon, uTop, 0.45) * (0.72 + 0.28 * uDaylight);
    col = mix(col, lid, uCloud * 0.8);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export interface SkyDome {
  mesh: THREE.Mesh;
  update(sky: SkyState, cloud: number): void;
  dispose(): void;
}

export function createSkyDome(): SkyDome {
  const geo = new THREE.SphereGeometry(1800, 32, 20);
  const uniforms = {
    uTop: { value: new THREE.Color(0x24446f) },
    uHorizon: { value: new THREE.Color(0x9ebad5) },
    uSunColor: { value: new THREE.Color(1, 0.98, 0.94) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uCloud: { value: 0 },
    uDaylight: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  // Draw first so everything else composites on top of it.
  mesh.renderOrder = -2;

  return {
    mesh,
    update(sky, cloud) {
      uniforms.uTop.value.setRGB(sky.skyTop[0], sky.skyTop[1], sky.skyTop[2]);
      uniforms.uHorizon.value.setRGB(sky.skyHorizon[0], sky.skyHorizon[1], sky.skyHorizon[2]);
      uniforms.uSunColor.value.setRGB(sky.sunColor[0], sky.sunColor[1], sky.sunColor[2]);
      uniforms.uSunDir.value.set(sky.sunDir[0], sky.sunDir[1], sky.sunDir[2]);
      uniforms.uCloud.value = cloud;
      uniforms.uDaylight.value = sky.daylight;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
