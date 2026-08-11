import * as THREE from 'three';
import { compassVec } from '../sim/math';

/**
 * Rain.
 *
 * A box of streaks that follows the camera. Rain is only ever seen close up, so
 * there is no point simulating any further than that -- a few thousand line
 * segments recycled through a moving volume reads exactly like a downpour.
 *
 * The streaks lean with the wind, which is what makes heavy weather feel windy
 * rather than merely wet.
 */

const MAX_DROPS = 4000;
/**
 * The volume the drops are recycled through, as a half-extent around the
 * camera, and the height they fall from.
 *
 * These are the whole reason rain was reported as arriving late. The sound and
 * the streaks are driven by the same eased `weather.rain`, and the sound is if
 * anything the slower of the two -- it has a 0.4 s smoothing the picture does
 * not. What differed was how much of each you get for the same number. A
 * broadband hiss at a sixth of full gain is plainly audible over a quiet sea;
 * a sixth of the drops was not visible at all, and nor, it turned out, were
 * all of them. At 90 m and 55 m the volume a drop recycles through was
 * 180 x 180 x 61 -- the height plus the six metres it goes on falling below
 * the surface before it is recycled -- which is 1.98 million cubic metres, so
 * even a downpour was one metre-long, one-pixel, third-opaque streak per
 * 494 m3. You heard rain that never appeared, so the sound always seemed to
 * lead.
 *
 * The file's own opening line already said where this went wrong -- rain is
 * only ever seen close up -- and 90 m is not close up. At 26 m the same 4000
 * drops fall through an eighteenth of the volume, 27 m3 each, and the height
 * comes down with the box because drops thirty metres overhead are spent on
 * nothing.
 *
 * No boundary shows at the edge, because drops this close subtend the width of
 * the frame; checked by looking, at the default field of view on an ordinary
 * aspect, where rain covers everything out to the horizon. What lies beyond is
 * `weather.visibility`, which is where distance closing in belongs.
 */
const BOX = 26;
const HEIGHT = 34;

export interface RainView {
  object: THREE.Object3D;
  /** intensity 0..1, windSpeed m/s, wind direction (compass rad it blows from) */
  update(
    intensity: number,
    windSpeed: number,
    twd: number,
    camera: THREE.Camera,
    dt: number,
  ): void;
  dispose(): void;
}

export function createRain(): RainView {
  const positions = new Float32Array(MAX_DROPS * 2 * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setDrawRange(0, 0);

  const material = new THREE.LineBasicMaterial({
    color: 0xaebccb,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geo, material);
  lines.frustumCulled = false;

  // Drop positions relative to the camera.
  const drops = new Float32Array(MAX_DROPS * 3);
  for (let i = 0; i < MAX_DROPS; i++) {
    drops[i * 3] = (Math.random() - 0.5) * BOX * 2;
    drops[i * 3 + 1] = Math.random() * HEIGHT;
    drops[i * 3 + 2] = (Math.random() - 0.5) * BOX * 2;
  }

  return {
    object: lines,
    update(intensity, windSpeed, twd, camera, dt) {
      const active = Math.floor(MAX_DROPS * Math.min(intensity * 1.15, 1));
      lines.visible = active > 8;
      if (!lines.visible) {
        geo.setDrawRange(0, 0);
        return;
      }

      // Wind blows from twd, so the rain travels the other way.
      const from = compassVec(twd);
      const wx = -from.x * windSpeed;
      const wz = from.y * windSpeed; // sim +y (north) is render -z
      const fall = 9 + intensity * 8;

      const cx = camera.position.x;
      const cy = camera.position.y;
      const cz = camera.position.z;

      for (let i = 0; i < active; i++) {
        const o = i * 3;
        drops[o] += wx * dt;
        drops[o + 1] -= fall * dt;
        drops[o + 2] += wz * dt;

        // Recycle through the volume rather than allocating new drops.
        if (drops[o + 1] < -6) {
          drops[o + 1] = HEIGHT;
          drops[o] = (Math.random() - 0.5) * BOX * 2;
          drops[o + 2] = (Math.random() - 0.5) * BOX * 2;
        }
        if (drops[o] > BOX) drops[o] -= BOX * 2;
        else if (drops[o] < -BOX) drops[o] += BOX * 2;
        if (drops[o + 2] > BOX) drops[o + 2] -= BOX * 2;
        else if (drops[o + 2] < -BOX) drops[o + 2] += BOX * 2;

        const px = cx + drops[o];
        const py = cy + drops[o + 1] - HEIGHT * 0.45;
        const pz = cz + drops[o + 2];

        // Streak length follows the actual velocity, so hard wind slants it.
        // Read as an exposure: 85 ms of travel. That is 0.77 m of fall in the
        // lightest rain and 1.38 m in the heaviest, and the wind lengthens it
        // further -- 1.65 m in a squall. Much shorter and it reads as hail.
        const len = 0.085;
        const v = i * 6;
        positions[v] = px;
        positions[v + 1] = py;
        positions[v + 2] = pz;
        positions[v + 3] = px - wx * len;
        positions[v + 4] = py + fall * len;
        positions[v + 5] = pz - wz * len;
      }

      geo.setDrawRange(0, active * 2);
      geo.attributes.position.needsUpdate = true;
      material.opacity = 0.18 + intensity * 0.3;
    },
    dispose() {
      geo.dispose();
      material.dispose();
    },
  };
}
