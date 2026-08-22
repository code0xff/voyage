import * as THREE from 'three';
import { FLARE_WARM } from './flare';
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
 * Cloud is a deck: one noise field in the plane of a cloud layer, seen in
 * perspective, thresholded into cover and shaded from its own density. The
 * caution this file used to carry -- that faking cumulus badly would look
 * worse than not having any -- was right, and it is why the shading is taken
 * from the field that makes the shape rather than painted on beside it. Cover
 * still flattens the sky's gradient towards a lid as well, but only about half
 * as far, because the drawn deck now does most of that work.
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
  uniform vec3 uFlareWarm;
  uniform float uFlareGlow;
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

  /**
   * Two octaves, and not for drawing anything: this is the field that bends
   * the deck's own coordinates before the deck is sampled. It only has to be
   * lumpy, so it is the cheapest thing that is.
   */
  float fbm2(vec2 p) {
    return vnoise(p) * 0.62 + vnoise(p * 2.03 + 5.2) * 0.31;
  }

  /**
   * How far the deck's own plane is magnified before the noise is sampled:
   * larger means smaller clouds, and more of them in the sky at once. One
   * unit of the plane is the horizontal distance to a point seen at
   * forty-five degrees up.
   */
  const float DECK_SCALE = 1.9;

  /**
   * The deck's density at a point in its own plane, 0..1 about a mean of half.
   *
   * Two things here that a plain fbm does not do.
   *
   * The **warp**. An fbm thresholded on its own gives round blobs with fractal
   * edges, and that is what this sky used to be full of: amorphous, soft, much
   * more like smoke than like cloud. Pushing the sample point around with a
   * coarser field of its own gives the billowed, sheared shapes a real deck
   * has, and it is by a distance the largest part of why this now reads as
   * cloud.
   *
   * The **footprint**. px is the width of one screen pixel in these same
   * plane units. Towards the horizon the projection stretches without limit,
   * so octaves arrive finer than a pixel can resolve -- and that is not
   * detail, it is noise being summed into the field, which is most of why the
   * far sky was a grey mush. Each octave fades out as it reaches that size.
   * What matters is that its weight leaves the normalisation with it: drop
   * octaves without renormalising and the mean of the field moves, which
   * slides the coverage threshold and lays a band of spurious cloud across the
   * sky at whatever distance the fade happens to be biting.
   */
  float deckDensity(vec2 uv, float px) {
    // 0.465 is fbm2's own mean, subtracted so the warp pushes the sample
    // point both ways about nothing. Leave it in and the whole deck is
    // displaced diagonally, which is invisible standing still and wrong the
    // moment it drifts.
    vec2 warp = vec2(fbm2(uv * 0.6 + 3.1), fbm2(uv * 0.6 - 7.4)) - 0.465;
    vec2 p = uv + warp * 0.8;

    float v = 0.0;
    float sum = 0.0;
    float a = 0.5;
    float f = 1.0;
    for (int i = 0; i < 5; i++) {
      // Full weight while the octave is wider than about six pixels, gone by
      // three. Below that it can only alias.
      float k = clamp(2.0 - px * f * 6.0, 0.0, 1.0);
      v += a * k * vnoise(p * f);
      sum += a * k;
      a *= 0.5;
      f *= 2.03;
    }
    // Where the projection has run so far that not one octave survives, the
    // honest answer is the field's own mean rather than zero: zero is a
    // guaranteed hole in the sky, and it would open just above the horizon --
    // above where the haze fade has finished closing the deck, so it shows.
    return sum > 1e-4 ? v / sum : 0.5;
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
   * Cloud cover, as a flat deck seen in perspective, and how lit each piece
   * of it is.
   *
   * Dividing the direction by its own height is what makes it a deck rather
   * than a pattern painted on the dome: features stretch and crowd together
   * towards the horizon exactly as a real cloud layer does, and that
   * foreshortening is most of what sells it. The cost is that the projection
   * runs away as the height goes to zero, so the last few degrees are faded out
   * -- which is also where real cloud is lost in haze.
   */
  vec2 cloudCover(vec3 d, float cosSun) {
    float up = max(d.y, 0.02);
    // The drift is added before the scale and not after, so that it is a rate
    // across the sky rather than a rate through the noise -- change how big
    // the clouds are and they still cross at the speed they were tuned to.
    vec2 uv = (d.xz / up + uCloudDrift) * DECK_SCALE;
    // One pixel, in the deck's own units. Measured from the projection and not
    // from the density: the density's own derivative near the horizon is the
    // difference between two unrelated samples, which is the aliasing itself
    // rather than a measure of it.
    //
    // Taken before the branch below, and that is not a matter of taste:
    // fwidth is the difference across a quad of pixels, so every pixel in the
    // quad has to reach it. Ask for it after a branch that only some of them
    // took and the answer is undefined rather than merely wrong.
    float px = length(fwidth(uv));

    // Nothing below the horizon. The dome is drawn before the sea and under
    // it, so without this the whole lower half of the frame pays for a deck
    // that the water then covers -- and this shader is the one thing here
    // that runs on every pixel of the frame.
    if (d.y < 0.02) return vec2(0.0, 0.5);

    float n = deckDensity(uv, px);

    // Coverage is a threshold on the density, and the threshold is what the
    // weather actually sets: a clear sky is the same field of cloud with almost
    // none of it reaching the bar, and an overcast is the same field again with
    // nearly all of it over.
    //
    // The band has to be narrow. A wide one puts most of the sky at partial
    // cover, and partial cover everywhere is not cloud, it is milk -- which is
    // exactly the failure the flat grey lid was written to avoid. It is now as
    // narrow as the pixel can hold and no narrower: a hard edge the projection
    // has squeezed below a pixel would crawl, so the footprint sets the width
    // and the far sky softens honestly instead of flickering.
    float lo = mix(0.78, 0.17, uCloud);
    float aa = clamp(px * 0.8, 0.016, 0.20);
    float cover = smoothstep(lo - aa, lo + aa, n);

    // The gaps have to be closed off well before the cover reaches one. The
    // weather calls 0.85 an overcast and an overcast has no blue in it; left to
    // the threshold alone the last gaps survive as flat blue puddles punched
    // through grey, which reads far worse than the featureless lid it replaced.
    cover = mix(cover, 1.0, smoothstep(0.62, 0.92, uCloud));
    cover *= smoothstep(0.02, 0.10, up);

    /*
     * How lit this piece of deck is -- read out of the same field that gave it
     * its shape, which is the whole point of it.
     *
     * It used to be a second, independent fbm, and the independence was the
     * fault: light and shade wandered across the cloud shapes with no regard
     * for them, so nothing in the sky had a form the lighting agreed with.
     * That is what a smear of smoke looks like, and it is what the sky looked
     * like.
     */

    // Thickness first, because a deck is seen from underneath: what decides
    // the tone of a piece of cloud base is how much cloud the light had to
    // come through to reach it. Thin fringes are near white, the deep middle
    // of a build-up is grey, and because this is the same warped field as the
    // shape, the shading billows exactly where the cloud does.
    //
    // Both this and the sun's side below ease off as the sky closes. A heavy
    // overcast is diffuse light through a deck with no gaps in it, so it has
    // little relief and no side at all; driven at fair-weather strength it
    // came out as marbling.
    float relief = 1.0 - 0.45 * uCloud;
    float thick = smoothstep(lo - 0.03, lo + 0.20, n);
    float lit = 1.0 - thick * 0.80 * relief;

    /*
     * Then the sun's side of it, by sampling the density one deck-thickness
     * towards the sun -- the piece of cloud that would be casting on this one
     * -- and letting the difference decide. Sun-facing flanks come out bright,
     * the far side and the base come out grey, and all of it moves when the
     * sun does. Nothing at noon, which is right: there is no side to a cloud
     * lit from straight above.
     *
     * uSunDir.xz / uSunDir.y is where the sun sits in the deck's own plane, so
     * that is the direction the caster lies in -- a shadow falls *away* from
     * the sun, so the thing casting one is towards it, which is the plus sign.
     * The height is floored because it goes to zero at sunrise and the step
     * would go to infinity with it.
     *
     * Only where there is cloud to shade. This second sample of the density
     * field is the most expensive thing in this shader, and on a fair day two
     * thirds of the sky is blue.
     */
    if (cover > 0.002) {
      vec2 sunStep = clamp(uSunDir.xz / max(uSunDir.y, 0.26), vec2(-4.0), vec2(4.0));
      // The deck's thickness as a fraction of its height, which is what makes
      // the offset a distance rather than a number: sunStep is in the plane's
      // own units, so it has to be carried through DECK_SCALE like everything
      // else. Leaving that out would silently change how deep the shading
      // reaches the next time the clouds are resized.
      float caster = deckDensity(uv + sunStep * (0.16 * DECK_SCALE), px);
      lit += (n - caster) * 2.2 * relief;
    }

    // The silver lining: cloud between you and the sun is lit from behind.
    // Forward scattering, and the one cloud effect people know by name.
    lit += pow(max(cosSun, 0.0), 8.0) * 0.6;

    return vec2(cover, clamp(lit, 0.0, 1.0));
  }

  void main() {
    vec3 d = normalize(vDir);
    // Height above the horizon, 0..1, biased so the gradient stacks near it.
    float h = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uTop, pow(h, 0.42));

    // A burning flare warms the sky's skirt. Hugging the horizon and gone by
    // overhead, because that is where a low star's light meets the haze --
    // and the stars above staying dark is what keeps a lifted night a night.
    col += uFlareWarm * (uFlareGlow * pow(1.0 - h, 2.0));

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
    vec2 deck = cloudCover(d, cosA);
    float cover = deck.x;
    // Even the brightest part of an overcast is not white, so the lit tone
    // comes down as the sky closes -- less far than the shade does, which is
    // what leaves an overcast with any contrast in it at all.
    vec3 bright = mix(vec3(1.0), uSunColor, 0.4) * (1.0 - 0.24 * uCloud);
    vec3 shade = mix(uHorizon, uTop, 0.3) * (0.5 + 0.5 * uDaylight);
    // Thicker weather is darker underneath: a fair-weather cumulus is white,
    // a rain cloud is not.
    shade *= 1.0 - 0.4 * uCloud;
    // How lit each piece of deck is comes back from cloudCover: it is decided
    // there, by the same density field that gave the deck its shape. How far
    // that reading is allowed to carry is the sun's business, though, and it
    // closes with the sun: a cloud has a lit side because something is
    // lighting it, and at midnight nothing is. Left open, a broken night came
    // out as pale grey blobs painted on black -- the shape read beautifully
    // and no night sky has ever looked like that.
    vec3 cloudCol = mix(shade, bright, deck.y * mix(0.16, 1.0, uDaylight));
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
    /** The scene's flash lift, 0 with nothing burning; see scene.ts. */
    flareLift: number,
    /** What that flash warms the sky toward -- amber for a flare, blue for a bolt. */
    flashColor: THREE.Color,
  ): void;
  dispose(): void;
}

/** rad per hour. The sky turns once a day; this part of it really is exact. */
const SIDEREAL_RATE = (2 * Math.PI) / 24;

/**
 * How far across the sky the cloud deck travels per world hour, at the wind's
 * rate. Units of the deck's own plane -- one is the horizontal distance to a
 * point seen at forty-five degrees up -- so it is a rate across the sky and
 * not a rate through the noise, and resizing the clouds does not change it.
 *
 * Not metres, and not the wind speed. Clouds ride a wind that is neither the
 * surface wind nor at the surface wind's speed, and even if it were, an hour of
 * world time passes in a minute at the default time scale -- a deck crossing
 * the sky at its honest rate would strobe. What has to be true is that the sky
 * moves the way the weather is moving, downwind and at a rate you can watch.
 * This number is what makes that read, and it was chosen by watching it.
 */
const CLOUD_DRIFT_PER_HOUR = 0.5;

export function createSkyDome(): SkyDome {
  const geo = new THREE.SphereGeometry(1800, 32, 20);
  const uniforms = {
    uTop: { value: new THREE.Color(0x24446f) },
    uHorizon: { value: new THREE.Color(0x9ebad5) },
    uFlareWarm: { value: FLARE_WARM },
    uFlareGlow: { value: 0 },
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
    update(sky, cloud, elapsedHours, windTwd, rainbow, dt, session, flareLift, flashColor) {
      uniforms.uFlareGlow.value = Math.min(0.7, flareLift * 0.45);
      uniforms.uFlareWarm.value = flashColor;
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
