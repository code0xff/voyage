import { mapProject, type Earth } from '../sim/earth';
import type { LatLon } from '../sim/globe';
import { token } from '../ui/tokens';

/**
 * The world map: where on the planet she is.
 *
 * The chart answers "what is around me" and stops at five kilometres, which
 * was the whole of the answer while a world was a twenty-kilometre window.
 * The Earth made a second question -- *where* am I -- that nothing on screen
 * could answer but a latitude and longitude in the instruments, and a number
 * is not an answer to a question about position. This draws it.
 *
 * Deliberately not a chart. Nothing here is navigable and nothing is clicked:
 * the coastline is a 37 km cell, the graticule is every thirty degrees, and
 * there is no scale on it. It is the picture on the wall of the cabin, and
 * the honest thing is that it looks like one rather than like an instrument
 * offering a precision it does not have.
 *
 * The land comes from `Earth.landMask`, which is the same reduction and the
 * same projection the marks are placed with -- see `mapProject` on why those
 * two must be one thing. Everything below is drawing.
 */

/**
 * The land layer, px. A third of a degree a cell, which is about the finest
 * the four-arc-minute raster can honestly be shown at: below this the picture
 * would be showing sampling noise as coastline.
 *
 * Displayed at whatever width the window gives, so this is a resolution and
 * not a size. Upscaled with smoothing off, because a soft coast at 1.2x reads
 * as a blurred photograph of a map rather than as a map.
 */
const MAP_W = 1080;
const MAP_H = 540;

/**
 * Where a leg crosses the date line, and which edge it leaves through --
 * or null if it stays on the sheet.
 *
 * The map is a cylinder slit down 180 degrees, so the two ends of a Pacific
 * crossing sit at opposite edges of it. Drawn as one straight line that is a
 * stripe all the way back across the world -- the wrong way round the planet,
 * through every continent -- and it looks exactly like a bug because it is
 * one. She sailed the shorter way: more than 180 degrees apart on the sheet
 * means less than 180 the other way round, which is the test below.
 *
 * `lat` is where she was as she crossed, taken as her share of the leg's
 * longitude. A straight line on this projection is not a course anyone
 * steers, so this is not navigation -- it is the latitude that makes the two
 * halves of the drawn line meet at the seam instead of stepping across it.
 *
 * `eastward` is true when `from` runs out through the right-hand edge, which
 * is the side its own longitude is on. Getting this backwards draws both
 * halves on the same side and leaves the other end of the leg unconnected.
 */
export function seamCrossing(from: LatLon, to: LatLon): { lat: number; eastward: boolean } | null {
  const apart = Math.abs(to.lon - from.lon);
  if (apart <= 180) return null;
  const eastward = from.lon > to.lon;
  // The shorter way round, and how much of it is spent getting to the seam.
  const span = 360 - apart;
  const toEdge = eastward ? 180 - from.lon : 180 + from.lon;
  const share = span > 0 ? toEdge / span : 0.5;
  return { lat: from.lat + (to.lat - from.lat) * share, eastward };
}

/** A passage as the map wants it: two ends on the Earth. */
export interface MapLeg {
  from: LatLon;
  to: LatLon;
}

export interface WorldMapInput {
  /** Where she is now. */
  place: LatLon;
  /** The departures, drawn as the doors they are. */
  departures: readonly LatLon[];
  /** What the logbook remembers, oldest or newest first -- it does not matter. */
  passages: readonly MapLeg[];
}

export interface WorldMapView {
  draw(ctx: CanvasRenderingContext2D, width: number, height: number, input: WorldMapInput): void;
}

/**
 * Two canvases and not one.
 *
 * `stencil` is the mask as pure alpha and is built once: it is 583,200 cells
 * of the planet and rebuilding it per frame is not a thing to contemplate.
 * `tinted` is that stencil filled with the theme's land colour through
 * `source-in`, which is how a themed colour is applied without ever parsing
 * one -- `token()` hands back a CSS colour string, and the 2D context is the
 * thing that already knows how to read those. It is rebuilt only when the
 * string changes, which is when the theme does.
 */
function stencilOf(mask: Uint8Array): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = MAP_W;
  c.height = MAP_H;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const img = ctx.createImageData(MAP_W, MAP_H);
  const px = img.data;
  for (let i = 0; i < mask.length; i++) {
    // White with the mask as alpha. The colour is irrelevant -- `source-in`
    // replaces it -- but it must not be transparent black, which some
    // compositors premultiply away.
    px[i * 4] = 255;
    px[i * 4 + 1] = 255;
    px[i * 4 + 2] = 255;
    px[i * 4 + 3] = mask[i];
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function createWorldMap(earth: Earth): WorldMapView {
  const stencil = stencilOf(earth.landMask(MAP_W, MAP_H));
  const tinted = document.createElement('canvas');
  tinted.width = MAP_W;
  tinted.height = MAP_H;
  let tintedWith = '';

  const landLayer = (colour: string): HTMLCanvasElement => {
    if (colour === tintedWith) return tinted;
    const ctx = tinted.getContext('2d');
    if (!ctx) return tinted;
    ctx.clearRect(0, 0, MAP_W, MAP_H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(stencil, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, MAP_W, MAP_H);
    ctx.globalCompositeOperation = 'source-over';
    tintedWith = colour;
    return tinted;
  };

  return {
    draw(ctx, width, height, input) {
      const at = (p: LatLon) => {
        const { x, y } = mapProject(p, width, height);
        return { x, y };
      };

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = token('--muted', 0.5);
      ctx.fillRect(0, 0, width, height);

      /*
       * Land lighter than the sea, and quieter than either mark on top of it.
       *
       * Lighter because the sea is what the sheet is mostly made of and a
       * dark ground is what the rest of this UI is; land as the lit shape is
       * the way round every dark map reads. Quieter because at 0.8 it was the
       * brightest thing on the sheet and the eye went to Asia rather than to
       * the boat, which is the one thing the map exists to show.
       */
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(landLayer(token('--muted-foreground', 0.55)), 0, 0, width, height);
      ctx.imageSmoothingEnabled = true;

      // Every thirty degrees, with the equator and the prime meridian a shade
      // stronger. Enough to read a position off by eye and not so much that
      // the map becomes a grid with some land in it.
      ctx.lineWidth = 1;
      for (let lon = -180; lon <= 180; lon += 30) {
        const { x } = at({ lat: 0, lon: lon === 180 ? 179.999 : lon });
        ctx.strokeStyle = token('--foreground', lon === 0 ? 0.16 : 0.08);
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, height);
        ctx.stroke();
      }
      for (let lat = -60; lat <= 60; lat += 30) {
        const { y } = at({ lat, lon: 0 });
        ctx.strokeStyle = token('--foreground', lat === 0 ? 0.16 : 0.08);
        ctx.beginPath();
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(width, Math.round(y) + 0.5);
        ctx.stroke();
      }

      /** A passage, cut at the date line if it crosses one. */
      const leg = (from: LatLon, to: LatLon) => {
        const a = at(from);
        const b = at(to);
        const seam = seamCrossing(from, to);
        ctx.beginPath();
        if (!seam) {
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        } else {
          // The same latitude on both edges, which is what makes the two
          // halves meet at the seam rather than step across it.
          const edgeY = at({ lat: seam.lat, lon: 0 }).y;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(seam.eastward ? width : 0, edgeY);
          ctx.moveTo(seam.eastward ? 0 : width, edgeY);
          ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
      };

      ctx.strokeStyle = token('--info', 0.55);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      for (const p of input.passages) leg(p.from, p.to);
      ctx.setLineDash([]);

      /*
       * The departures: hollow, because they are somewhere she could be and
       * not somewhere she is.
       *
       * Every one of them is four kilometres off a coast, which at 37 km a
       * cell means every one is drawn on or beside a land pixel -- so a plain
       * light ring is a light mark on a light ground and disappears. The dark
       * halo underneath is what makes them findable, and it costs a stroke.
       */
      for (const d of input.departures) {
        const { x, y } = at(d);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.strokeStyle = token('--background', 0.7);
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.strokeStyle = token('--foreground', 0.75);
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Her. A ring round it as well as a dot, because a single dot at this
      // scale is indistinguishable from an island.
      const me = at(input.place);
      ctx.beginPath();
      ctx.arc(me.x, me.y, 3, 0, Math.PI * 2);
      ctx.strokeStyle = token('--background', 0.8);
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = token('--info');
      ctx.fill();
      ctx.strokeStyle = token('--info', 0.5);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(me.x, me.y, 7.5, 0, Math.PI * 2);
      ctx.stroke();
    },
  };
}
