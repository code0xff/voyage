import * as THREE from 'three';
import type { Course, RaceState } from '../sim/race';
import type { WaveField } from '../sim/waves';
import type { GhostSample } from '../sim/replay';

/**
 * Race course rendering.
 *
 * The buoys have to ride the waves. Leave them as fixed cylinders and water
 * passes straight through them, which makes the whole sea look fake. One buoy
 * bobbing changes how solid the surface reads.
 *
 * Only the next target is lit; everything else is dimmed. If all three marks
 * were equally bright the player would have to work out where to go every
 * single time they looked up.
 */

const NEXT_COLOR = 0xffb347;
const DONE_COLOR = 0x44525f;
const PIN_COLOR = 0xd94f6a;

function buoy(color: number, scale = 1): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.85 * scale, 1.15 * scale, 2.4 * scale, 10),
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, emissive: color, emissiveIntensity: 0.25 }),
  );
  body.position.y = 1.0 * scale;
  g.add(body);

  const top = new THREE.Mesh(
    new THREE.ConeGeometry(0.85 * scale, 1.6 * scale, 10),
    new THREE.MeshStandardMaterial({ color, roughness: 0.5, emissive: color, emissiveIntensity: 0.4 }),
  );
  top.position.y = 3.0 * scale;
  g.add(top);
  return g;
}

export interface CourseView {
  group: THREE.Object3D;
  update(course: Course, race: RaceState, waves: WaveField): void;
  setGhost(sample: GhostSample | null): void;
}

export function createCourseView(): CourseView {
  const group = new THREE.Group();

  const windwardBuoy = buoy(NEXT_COLOR, 1.5);
  const leewardBuoy = buoy(NEXT_COLOR, 1.5);
  const pinBuoy = buoy(PIN_COLOR);
  const rcBuoy = buoy(PIN_COLOR);
  group.add(windwardBuoy, leewardBuoy, pinBuoy, rcBuoy);

  // Start / finish line
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const lineMesh = new THREE.Line(
    lineGeo,
    new THREE.LineBasicMaterial({ color: PIN_COLOR, transparent: true, opacity: 0.7 }),
  );
  lineMesh.frustumCulled = false;
  group.add(lineMesh);

  // Ghost: a translucent replay of the previous run
  const ghostGroup = new THREE.Group();
  const ghostMat = new THREE.MeshStandardMaterial({
    color: 0x7fe3d8,
    transparent: true,
    opacity: 0.3,
    emissive: 0x2b6b64,
  });
  const ghostHull = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.4, 9.5), ghostMat);
  ghostHull.position.y = 0.3;
  const ghostMast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 12, 6), ghostMat);
  ghostMast.position.set(0, 6.5, -1.2);
  const ghostHeel = new THREE.Group();
  ghostHeel.add(ghostHull, ghostMast);
  ghostGroup.add(ghostHeel);
  ghostGroup.visible = false;
  group.add(ghostGroup);

  const place = (obj: THREE.Object3D, x: number, y: number, waves: WaveField) => {
    obj.position.set(x, waves.heightAt(x, y), -y);
  };

  // update() runs before setGhost(). The ghost has to ride the same water,
  // otherwise your boat sits on the waves while the ghost slides across a
  // flat plane.
  let lastWaves: WaveField | null = null;

  return {
    group,
    update(course, race, waves) {
      lastWaves = waves;
      place(windwardBuoy, course.windward.pos.x, course.windward.pos.y, waves);
      place(leewardBuoy, course.leeward.pos.x, course.leeward.pos.y, waves);
      place(pinBuoy, course.start.a.x, course.start.a.y, waves);
      place(rcBuoy, course.start.b.x, course.start.b.y, waves);

      // Buoys lean with the surface too; ramrod-straight still reads as fake.
      const tilt = (obj: THREE.Object3D, x: number, y: number) => {
        const d = 1.5;
        const gx = (waves.heightAt(x + d, y) - waves.heightAt(x - d, y)) / (2 * d);
        const gy = (waves.heightAt(x, y + d) - waves.heightAt(x, y - d)) / (2 * d);
        obj.rotation.set(-gy * 0.8, 0, -gx * 0.8, 'XZY');
      };
      tilt(windwardBuoy, course.windward.pos.x, course.windward.pos.y);
      tilt(leewardBuoy, course.leeward.pos.x, course.leeward.pos.y);
      tilt(pinBuoy, course.start.a.x, course.start.a.y);
      tilt(rcBuoy, course.start.b.x, course.start.b.y);

      const lp = lineGeo.attributes.position as THREE.BufferAttribute;
      lp.setXYZ(0, course.start.a.x, waves.heightAt(course.start.a.x, course.start.a.y) + 1.2, -course.start.a.y);
      lp.setXYZ(1, course.start.b.x, waves.heightAt(course.start.b.x, course.start.b.y) + 1.2, -course.start.b.y);
      lp.needsUpdate = true;

      // Light only the current target
      const leg = course.legs[race.legIndex];
      const targetsWindward = leg?.mark?.id === 'W';
      const targetsLeeward = leg?.mark?.id === 'L';
      const setColor = (g: THREE.Group, active: boolean, base: number) => {
        g.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
          if (m?.color) {
            m.color.setHex(active ? base : DONE_COLOR);
            m.emissive.setHex(active ? base : 0x000000);
          }
        });
      };
      setColor(windwardBuoy, targetsWindward, NEXT_COLOR);
      setColor(leewardBuoy, targetsLeeward, NEXT_COLOR);
      const lineActive = leg?.kind === 'start' || leg?.kind === 'finish';
      setColor(pinBuoy, lineActive, PIN_COLOR);
      setColor(rcBuoy, lineActive, PIN_COLOR);
      lineMesh.visible = lineActive;
    },
    setGhost(sample) {
      if (!sample) {
        ghostGroup.visible = false;
        return;
      }
      ghostGroup.visible = true;
      ghostGroup.position.set(sample.x, lastWaves?.heightAt(sample.x, sample.y) ?? 0, -sample.y);
      ghostGroup.rotation.y = -sample.heading;
      ghostHeel.rotation.z = -sample.heel;
    },
  };
}
