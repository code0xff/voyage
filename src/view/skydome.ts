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
 *
 * Stars are drawn, because a night sky without them is the one thing about this
 * sky that reads as missing rather than as simplified. They are procedural and
 * make no claim to be a catalogue: the sun here is not astronomical either, and
 * a real one would only invite the question of why the constellations are wrong.
 * What *is* right is that the whole field turns about a celestial pole at
 * fifteen degrees an hour, which is free and is the cue that time is passing.
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
  uniform float uStarAngle;

  varying vec3 vDir;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }

  /**
   * Stars, as cells on the sphere that either hold one or do not.
   *
   * Celled in 3D rather than on azimuth and elevation on purpose: a lat-long
   * grid piles its cells up at the zenith, and the sky would visibly thicken
   * straight overhead. Cubes of direction space are near enough even.
   */
  float starField(vec3 d) {
    // Turn the sky about the celestial pole. Mid-latitude, so the pole sits
    // about 52 degrees up in the north; render z runs south, hence the minus.
    vec3 axis = vec3(0.0, 0.788, -0.616);
    float c = cos(uStarAngle);
    float s = sin(uStarAngle);
    vec3 r = d * c + cross(axis, d) * s + axis * dot(axis, d) * (1.0 - c);

    vec3 p = r * 190.0;
    vec3 cell = floor(p);
    // About one cell in twelve holds a star. Much more and the sky reads as
    // noise rather than as stars.
    float present = step(0.92, hash13(cell));
    // Kept clear of the cell walls, so a star is never clipped in half by one.
    vec3 at = hash33(cell + 7.1) * 0.7 + 0.15;
    float dist = length(fract(p) - at);
    // A few bright ones and a great many faint: the square is not the real
    // magnitude distribution but it has the right shape, which is what stops
    // the field looking like evenly sprinkled salt. The floor under it is there
    // because a faint star still has to survive being one pixel -- taken all
    // the way down, most of the field simply did not show.
    float m = hash13(cell + 19.7);
    float mag = 0.16 + 0.84 * m * m;
    return present * mag * smoothstep(0.21, 0.0, dist);
  }

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

    // Stars go on after the lid, not before it: the lid keeps a fifth of what
    // is under it, and a solid overcast that let a fifth of the stars through
    // would be a hole in the one thing cloud is certain to do.
    float night = smoothstep(0.32, 0.02, uDaylight);
    // The last few degrees above the horizon are all haze, and stars go out in
    // it long before they set. This is also what keeps them off the sea.
    float clear = smoothstep(0.0, 0.14, d.y);
    col += vec3(0.86, 0.89, 1.0) * starField(d) * night * clear * (1.0 - uCloud);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export interface SkyDome {
  mesh: THREE.Mesh;
  /**
   * @param elapsedHours world time since the session began, unwrapped. The sky's
   *        own `hour` wraps at midnight, and turning the stars with that would
   *        spin the whole field back through a day every night.
   */
  update(sky: SkyState, cloud: number, elapsedHours: number): void;
  dispose(): void;
}

/** rad per hour. The sky turns once a day; this part of it really is exact. */
const SIDEREAL_RATE = (2 * Math.PI) / 24;

export function createSkyDome(): SkyDome {
  const geo = new THREE.SphereGeometry(1800, 32, 20);
  const uniforms = {
    uTop: { value: new THREE.Color(0x24446f) },
    uHorizon: { value: new THREE.Color(0x9ebad5) },
    uSunColor: { value: new THREE.Color(1, 0.98, 0.94) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uCloud: { value: 0 },
    uDaylight: { value: 1 },
    uStarAngle: { value: 0 },
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
    update(sky, cloud, elapsedHours) {
      uniforms.uTop.value.setRGB(sky.skyTop[0], sky.skyTop[1], sky.skyTop[2]);
      uniforms.uHorizon.value.setRGB(sky.skyHorizon[0], sky.skyHorizon[1], sky.skyHorizon[2]);
      uniforms.uSunColor.value.setRGB(sky.sunColor[0], sky.sunColor[1], sky.sunColor[2]);
      uniforms.uSunDir.value.set(sky.sunDir[0], sky.sunDir[1], sky.sunDir[2]);
      uniforms.uCloud.value = cloud;
      uniforms.uDaylight.value = sky.daylight;
      uniforms.uStarAngle.value = elapsedHours * SIDEREAL_RATE;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
