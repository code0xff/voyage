import * as THREE from 'three';
import { approach } from '../sim/math';
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
  uniform float uRainbow;
  uniform vec2 uCloudDrift;

  varying vec3 vDir;

  /** Inner edge to outer, violet through to red. */
  vec3 spectrum(float t) {
    vec3 c = mix(vec3(0.42, 0.12, 0.78), vec3(0.16, 0.36, 0.96), smoothstep(0.0, 0.28, t));
    c = mix(c, vec3(0.20, 0.86, 0.38), smoothstep(0.26, 0.52, t));
    c = mix(c, vec3(0.98, 0.92, 0.22), smoothstep(0.50, 0.72, t));
    c = mix(c, vec3(1.00, 0.36, 0.10), smoothstep(0.70, 1.0, t));
    return c;
  }

  /** Brightest in the middle of the band, gone at either edge. */
  float band(float ang, float inner, float outer) {
    float t = (ang - inner) / (outer - inner);
    if (t <= 0.0 || t >= 1.0) return 0.0;
    return sin(t * 3.14159265);
  }

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

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * vnoise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }

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

  /**
   * Cloud cover, as a flat deck seen in perspective.
   *
   * Dividing the direction by its own height is what makes it a deck rather
   * than a pattern painted on the dome: features stretch and crowd together
   * towards the horizon exactly as a real cloud layer does, and that
   * foreshortening is most of what sells it. The cost is that the projection
   * runs away as the height goes to zero, so the last few degrees are faded out
   * -- which is also where real cloud is lost in haze.
   */
  vec2 cloudCover(vec3 d) {
    float up = d.y;
    if (up < 0.02) return vec2(0.0, 0.5);
    vec2 uv = d.xz / up * 1.1 + uCloudDrift;
    float n = fbm(uv);

    // Coverage is a threshold on the noise, and the threshold is what the
    // weather actually sets: a clear sky is the same field of cloud with almost
    // none of it reaching the bar, and an overcast is the same field again with
    // nearly all of it over.
    //
    // The band has to be narrow. A wide one puts most of the sky at partial
    // cover, and partial cover everywhere is not cloud, it is milk -- which is
    // exactly the failure the flat grey lid was written to avoid.
    float lo = mix(0.74, 0.16, uCloud);
    float cover = smoothstep(lo, lo + 0.11, n);

    // The gaps have to be closed off well before the cover reaches one. The
    // weather calls 0.85 an overcast and an overcast has no blue in it; left to
    // the threshold alone the last gaps survive as flat blue puddles punched
    // through grey, which reads far worse than the featureless lid it replaced.
    cover = mix(cover, 1.0, smoothstep(0.62, 0.92, uCloud));

    // Tone within the deck, at a finer scale than the cover itself. Without it
    // a closed sky is one flat grey -- which is true of the *colour* of an
    // overcast and quite untrue of the look, because the last thing a real one
    // is is featureless.
    float tone = fbm(uv * 2.7 + 11.3);
    return vec2(cover * smoothstep(0.02, 0.10, up), tone);
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

    // Overcast still flattens the gradient towards a lid, but only about half
    // as hard as it used to: the drawn deck below now does most of that work,
    // and doing it twice left a solid sky with no shape in it at all.
    vec3 lid = mix(uHorizon, uTop, 0.45) * (0.72 + 0.28 * uDaylight);
    col = mix(col, lid, uCloud * 0.42);

    // Cloud. Sunlit on the side the sun is on, and its own shadow away from it,
    // which is the whole of why a sky at sunset is worth looking at.
    vec2 deck = cloudCover(d);
    float cover = deck.x;
    vec3 bright = mix(vec3(1.0), uSunColor, 0.4) * (0.3 + 0.7 * uDaylight);
    vec3 shade = mix(uHorizon, uTop, 0.3) * (0.5 + 0.5 * uDaylight);
    // Thicker weather is darker underneath: a fair-weather cumulus is white,
    // a rain cloud is not.
    shade *= 1.0 - 0.4 * uCloud;
    // Two things decide how lit a piece of deck is: which way the sun is, and
    // its own thickness. The second is what keeps a closed sky from being one
    // flat tone.
    float lit = clamp(pow(cosA, 2.0) * 0.55 + deck.y * 0.7 - 0.05, 0.0, 1.0);
    vec3 cloudCol = mix(shade, bright, lit);
    col = mix(col, cloudCol, cover);

    /**
     * The bow.
     *
     * Every angle here is measured from the antisolar point -- straight away
     * from the sun -- because that is what a rainbow is centred on, and it is
     * why you have to have the sun behind you to see one. Nothing about the
     * geometry is a choice: 42 degrees for the primary, 51 for the secondary
     * with its colours the other way round, and the sky between the two
     * genuinely darker than the sky outside either, because no light comes back
     * at those angles at all. That last one is Alexander's band, it has been
     * known since about 200 AD, and it is the detail that makes a drawn bow
     * stop looking like a decal.
     *
     * Drawn additively and over the cloud, which is where it belongs: the rain
     * carrying it is a few hundred metres away and the deck is not.
     */
    if (uRainbow > 0.001) {
      float ang = acos(clamp(dot(d, -normalize(uSunDir)), -1.0, 1.0));
      float primary = band(ang, 0.7068, 0.7453);   // 40.5 .. 42.7 deg
      float secondary = band(ang, 0.8814, 0.9483); // 50.5 .. 54.3 deg
      // The arc runs into the sea at the horizon; the water shader knows
      // nothing about it, so it has to end where the sky does.
      float above = smoothstep(0.0, 0.035, d.y);
      float k = uRainbow * above;

      // Alexander's band, between the two arcs.
      // Written as one-minus-smoothstep, not as a descending smoothstep:
      // GLSL leaves the result undefined when edge0 >= edge1, and it is the
      // kind of thing that works on the driver it was written against.
      float inside = smoothstep(0.745, 0.79, ang) * (1.0 - smoothstep(0.86, 0.90, ang));
      col *= 1.0 - 0.075 * k * inside;

      col += spectrum((ang - 0.7068) / 0.0385) * primary * k * 0.42;
      // Fainter, and washed towards white: the second reflection loses most of
      // the light and what is left is spread over nearly twice the width.
      col += mix(spectrum(1.0 - (ang - 0.8814) / 0.0669), vec3(0.8), 0.35) * secondary * k * 0.12;
    }

    // Stars go on last, behind whatever cloud is actually in front of them --
    // the cover at this pixel rather than the sky's average cover, so a broken
    // night shows stars through the gaps and closes them again as the deck
    // passes over. That is the one thing that makes the two features worth
    // having in the same shader.
    float night = smoothstep(0.32, 0.02, uDaylight);
    // The last few degrees above the horizon are all haze, and stars go out in
    // it long before they set. This is also what keeps them off the sea.
    float clear = smoothstep(0.0, 0.14, d.y);
    col += vec3(0.86, 0.89, 1.0) * starField(d) * night * clear * (1.0 - cover);

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
  update(
    sky: SkyState,
    cloud: number,
    elapsedHours: number,
    windTwd: number,
    rainbow: number,
    dt: number,
    session: number,
  ): void;
  dispose(): void;
}

/** rad per hour. The sky turns once a day; this part of it really is exact. */
const SIDEREAL_RATE = (2 * Math.PI) / 24;

/**
 * Noise-domain units the cloud deck travels per world hour, at the wind's rate.
 *
 * Not metres, and not the wind speed. Clouds ride a wind that is neither the
 * surface wind nor at the surface wind's speed, and even if it were, an hour of
 * world time passes in a minute at the default time scale -- a deck crossing
 * the sky at its honest rate would strobe. What has to be true is that the sky
 * moves the way the weather is moving, downwind and at a rate you can watch.
 * This number is what makes that read, and it was chosen by watching it.
 */
const CLOUD_DRIFT_PER_HOUR = 0.55;

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
    uRainbow: { value: 0 },
    uCloudDrift: { value: new THREE.Vector2() },
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
  let displayedRainbow = 0;
  let lastSession = -1;

  return {
    mesh,
    update(sky, cloud, elapsedHours, windTwd, rainbow, dt, session) {
      if (session !== lastSession) {
        displayedRainbow = 0;
        lastSession = session;
      }
      uniforms.uTop.value.setRGB(sky.skyTop[0], sky.skyTop[1], sky.skyTop[2]);
      uniforms.uHorizon.value.setRGB(sky.skyHorizon[0], sky.skyHorizon[1], sky.skyHorizon[2]);
      uniforms.uSunColor.value.setRGB(sky.sunColor[0], sky.sunColor[1], sky.sunColor[2]);
      uniforms.uSunDir.value.set(sky.sunDir[0], sky.sunDir[1], sky.sunDir[2]);
      uniforms.uCloud.value = cloud;
      uniforms.uDaylight.value = sky.daylight;
      uniforms.uStarAngle.value = elapsedHours * SIDEREAL_RATE;
      // Weather and solar geometry decide the target instantly, but water
      // droplets do not assemble into a decal. Let the bow gather over about
      // a second and dissolve more slowly when the shower or sunlight leaves.
      const fadeSeconds = rainbow > displayedRainbow ? 0.45 : 0.8;
      displayedRainbow = approach(displayedRainbow, rainbow, fadeSeconds, dt);
      uniforms.uRainbow.value = displayedRainbow;
      // Downwind: `twd` is where the wind comes *from*, and the cloud goes the
      // other way. Render coordinates put x east and z south, so a compass
      // bearing b is (sin b, -cos b) -- and the deck's own uv is that plane.
      const to = windTwd + Math.PI;
      const run = elapsedHours * CLOUD_DRIFT_PER_HOUR;
      uniforms.uCloudDrift.value.set(-Math.sin(to) * run, Math.cos(to) * run);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
