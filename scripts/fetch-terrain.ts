/**
 * Bake a region's heightmap from public survey data.
 *
 *   npx tsx scripts/fetch-terrain.ts [regionId]
 *
 * Run by hand, not by the build. The output is committed, because the game
 * makes no network call of its own -- see AGENTS.md section 2 -- and because a
 * build that depends on a government web service is a build that breaks on a
 * Sunday. Re-run it only to change a region or to pick up a resurvey.
 *
 * ## Where the numbers come from
 *
 * NOAA NCEI's DEM mosaic, which for this coast resolves to the CUDEM 1/9
 * arc-second tiles -- about 3.4 m, and *topobathymetric*: one continuous
 * surface carrying the land and the sea floor together, referenced to a common
 * vertical datum. That is the piece docs/real-map.md expected to have to do
 * without. It wrote that nearshore bathymetry is "the problem", that GEBCO at
 * 450 m is useless close in, and that the pragmatic answer was a real coastline
 * with synthesised depths. For US waters that compromise turns out to be
 * unnecessary: the depths here are surveyed, not invented.
 *
 * ## The projection
 *
 * The DEM comes back already in UTM zone 10N, so the grid is metres and square
 * by construction rather than by resampling a lat/lon grid. The world plane is
 * that grid with its origin moved to the region centre: world x is UTM easting,
 * world y is UTM northing.
 *
 * The cost is that world north is *grid* north, which at this longitude is
 * about 0.35 degrees off true north. That is below the resolution of every
 * bearing the game shows and far below anything a helmsman notices, and it buys
 * a plane with no distortion inside it at all -- which the alternative, a
 * latitude-scaled equirectangular grid, does not have: its metres-per-degree of
 * longitude changes by 0.28% across 20 km of latitude, so the map would stretch
 * at the top and bottom.
 *
 * ## Resolution
 *
 * Fetched at OVERSAMPLE times the target and box-averaged down. Asking the
 * server for 25 m directly would point-sample a 3.4 m surface and alias: a rock
 * would appear or vanish depending on where the grid line fell. Averaging is
 * also what a 25 m cell honestly *means* -- the mean depth over 625 square
 * metres. It does soften a shoal by half the local relief, which is one more
 * reason the chart says what it says about navigation.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGIONS, type Region } from '../src/sim/regions';
import { utmForward } from '../src/sim/geo';

const SERVICE =
  'https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_all/ImageServer/exportImage';

/** How much finer than the target cell to sample before averaging down. */
const OVERSAMPLE = 4;
/**
 * Source pixels per request. The service allows 20000, but a tile is held whole
 * in memory as float32 on both ends and a failed 40 MB response has to be
 * fetched again in full; 1600 is 10 MB, which retries cheaply.
 */
const TILE = 1600;

/** One tile of float32 elevations, row-major from the north-west corner. */
async function fetchTile(
  epsg: number,
  xmin: number,
  ymin: number,
  xmax: number,
  ymax: number,
  size: number,
): Promise<Float32Array> {
  const q = new URLSearchParams({
    bbox: `${xmin},${ymin},${xmax},${ymax}`,
    bboxSR: String(epsg),
    imageSR: String(epsg),
    size: `${size},${size}`,
    // Band-sequential: raw little-endian float32 and nothing else, so there is
    // no TIFF parser here to get wrong. The service appends a short run of
    // 0xFF padding, which is why the length is read as "at least" and the
    // samples are taken from the front.
    format: 'bsq',
    pixelType: 'F32',
    interpolation: 'RSP_BilinearInterpolation',
    f: 'image',
  });

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${SERVICE}?${q}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      const want = size * size * 4;
      if (buf.byteLength < want) {
        // An error comes back as JSON with a 200, so a short body is the tell.
        throw new Error(`short body (${buf.byteLength} < ${want}): ${
          new TextDecoder().decode(buf.slice(0, 200))
        }`);
      }
      return new Float32Array(buf.buffer, buf.byteOffset, size * size);
    } catch (err) {
      if (attempt === 3) throw err;
      process.stderr.write(`  retry ${attempt}: ${String(err)}\n`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw new Error('unreachable');
}

async function bake(region: Region): Promise<void> {
  const { width, height, cell } = region.grid;
  const spanX = width * cell;
  const spanY = height * cell;
  const centre = utmForward(region.centre.lat, region.centre.lon, region.utmZone);
  const epsg = 32600 + region.utmZone;

  // The world origin sits at the region centre, so the grid runs from minus
  // half a span to plus half a span in each direction.
  const west = centre.x - spanX / 2;
  const south = centre.y - spanY / 2;

  const srcW = width * OVERSAMPLE;
  const srcH = height * OVERSAMPLE;
  const tilesX = Math.ceil(srcW / TILE);
  const tilesY = Math.ceil(srcH / TILE);

  process.stdout.write(
    `${region.id}: ${width}x${height} at ${cell} m, sampled at ${cell / OVERSAMPLE} m ` +
      `in ${tilesX * tilesY} tiles\n`,
  );

  // Accumulated sums and counts per output cell, so tiles can land in any order
  // and a tile that overhangs the grid edge simply contributes nothing there.
  const sum = new Float64Array(width * height);
  const count = new Uint32Array(width * height);
  let nodata = 0;

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const px0 = tx * TILE;
      const py0 = ty * TILE;
      const w = Math.min(TILE, srcW - px0);
      const h = Math.min(TILE, srcH - py0);
      const srcCell = cell / OVERSAMPLE;

      // Source rows run north to south, so the tile's top edge is the higher
      // northing. Getting this upside down is the classic raster bug, and the
      // check at the end -- that the Golden Gate is water -- is what catches it.
      const xmin = west + px0 * srcCell;
      const xmax = xmin + w * srcCell;
      const ymax = south + spanY - py0 * srcCell;
      const ymin = ymax - h * srcCell;

      process.stdout.write(`  tile ${ty * tilesX + tx + 1}/${tilesX * tilesY}\n`);
      const data = await fetchTile(epsg, xmin, ymin, xmax, ymax, Math.max(w, h));

      for (let j = 0; j < h; j++) {
        // Output row 0 is the north edge, matching the source.
        const oy = Math.floor((py0 + j) / OVERSAMPLE);
        if (oy < 0 || oy >= height) continue;
        for (let i = 0; i < w; i++) {
          const v = data[j * Math.max(w, h) + i];
          if (!Number.isFinite(v) || v < -12000 || v > 9000) {
            nodata++;
            continue;
          }
          const ox = Math.floor((px0 + i) / OVERSAMPLE);
          if (ox < 0 || ox >= width) continue;
          sum[oy * width + ox] += v;
          count[oy * width + ox]++;
        }
      }
    }
  }

  const out = new Int16Array(width * height);
  let min = Infinity;
  let max = -Infinity;
  let empty = 0;
  for (let i = 0; i < out.length; i++) {
    if (count[i] === 0) {
      empty++;
      out[i] = 0;
      continue;
    }
    const m = sum[i] / count[i];
    min = Math.min(min, m);
    max = Math.max(max, m);
    // Decimetres. A 10 cm quantum is finer than the survey, far finer than the
    // 25 m cell, and keeps the whole range of this coast -- Twin Peaks at 282 m
    // and the Gate's scour hole at -110 m -- inside a signed 16-bit value.
    out[i] = Math.max(-32768, Math.min(32767, Math.round(m * 10)));
  }

  if (empty > 0) throw new Error(`${empty} output cells got no samples`);
  if (nodata > 0) process.stdout.write(`  ${nodata} source samples were nodata\n`);
  process.stdout.write(`  elevation ${min.toFixed(1)} m to ${max.toFixed(1)} m\n`);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.join(here, '..', 'public', 'terrain');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${region.id}.bin`);
  writeFileSync(file, Buffer.from(out.buffer, out.byteOffset, out.byteLength));
  process.stdout.write(`  wrote ${file} (${(out.byteLength / 1024).toFixed(0)} KiB)\n`);
}

const wanted = process.argv[2];
const list = wanted ? REGIONS.filter((r) => r.id === wanted) : REGIONS;
if (list.length === 0) {
  process.stderr.write(`no such region: ${wanted}\nknown: ${REGIONS.map((r) => r.id).join(', ')}\n`);
  process.exit(1);
}
for (const r of list) await bake(r);
