import * as THREE from 'three';

/**
 * The flare's light, hanging in the scene.
 *
 * Two objects and a number. The PointLight is what lets the hull, the sails
 * and the land answer the flare -- they are standard materials, so a real
 * light is all it takes. The sprite is the star itself: a small additive
 * glow, because a light source seen directly is the one thing a lit scene
 * cannot show on its own. And the returned level is for the water, whose
 * shader takes no scene lighting at all and draws its pool explicitly, the
 * same arrangement the deck lamps settled on (see the lamp block in
 * water.ts).
 *
 * The flicker lives here and not in the engine's published intensity: an
 * unsteady burn is a *look*, the same class of thing as the glow's size, and
 * the engine's number stays the clean envelope a test can hold.
 */
export interface FlareInput {
  x: number;
  y: number;
  alt: number;
  intensity: number;
}

/**
 * Candela at full burn. Five times what a real parachute rocket makes, and
 * unapologetically so: this is not a photometric model -- three's
 * inverse-square units against this scene's night lighting simply needed
 * this much before the sails read as lit, and the number was found by
 * firing it and looking, the way the water pool's weights were.
 */
const FLARE_CANDELA = 150_000;

export function createFlareView(scene: THREE.Scene): {
  update(f: FlareInput | null, daylight: number, visibility: number, dt: number): number;
  dispose(): void;
} {
  const light = new THREE.PointLight(0xffcf9a, 0, 0, 2);
  light.visible = false;
  scene.add(light);

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,244,220,1)');
    g.addColorStop(0.25, 'rgba(255,214,150,0.8)');
    g.addColorStop(0.6, 'rgba(255,180,110,0.25)');
    g.addColorStop(1, 'rgba(255,160,90,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // The scene's fog ends at 560 m and the star hangs 500 slant metres
      // out: fogged, it
      // vanished entirely while its pool stayed on the water -- a light with
      // no visible source. A burning flare is the one thing out there that
      // genuinely outshines the haze.
      fog: false,
    }),
  );
  sprite.visible = false;
  scene.add(sprite);

  let burn = 0;

  return {
    update(f, daylight, visibility, dt) {
      if (!f || f.intensity <= 0.001) {
        light.visible = false;
        light.intensity = 0;
        sprite.visible = false;
        burn = 0;
        return 0;
      }
      burn += dt;
      // By day the star is a spark and the light does next to nothing, which
      // is true of the real thing and saves anyone wondering why the sea did
      // not change. The floor keeps the sprite findable at noon.
      const night = 1 - daylight * 0.85;
      // Two incommensurate sines: unsteady without ever repeating on a beat.
      const flicker = 0.87 + 0.09 * Math.sin(burn * 11.3) + 0.04 * Math.sin(burn * 27.7);
      const level = f.intensity * night * flicker;

      light.visible = true;
      light.position.set(f.x, f.alt, -f.y);
      light.intensity = level * FLARE_CANDELA;

      sprite.visible = true;
      sprite.position.set(f.x, f.alt, -f.y);
      // The star ignores the distance fog (see the material) but not the
      // weather: in a 300 m visibility it hangs ~500 m off, and a crisp orb
      // through that would give the whole haze away. The floor keeps it a
      // dim smudge rather than gone -- a burning flare is genuinely the
      // brightest thing out there.
      const haze = Math.min(1, Math.max(0.12, visibility / 900));
      sprite.material.opacity = Math.min(1, f.intensity * (0.4 + 0.6 * night) * haze);
      const s = 22 * (0.85 + 0.25 * flicker);
      sprite.scale.set(s, s, 1);
      return level;
    },
    dispose() {
      scene.remove(light);
      scene.remove(sprite);
      light.dispose();
      sprite.material.dispose();
      texture.dispose();
    },
  };
}
