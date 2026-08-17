/**
 * Build the coarse global height field the whole-Earth world is drawn from.
 *
 *     npx tsx scripts/fetch-globe.ts            # 4 arc-minute, the shipped grid
 *     npx tsx scripts/fetch-globe.ts 8          # coarser, for a quick trial
 *
 * Writes `public/terrain/globe-<arcmin>m.bin`: an Int16Array of metres, row
 * major from the north-west corner at (90N, 180W), the same layout and the
 * same units as every surveyed raster in `public/terrain`. One file, no
 * tiling: at 4 arc-minutes the whole planet is 29 MB raw and about 7 as a
 * gzip on the wire, which is less than the six surveyed squares together.
 *
 * **The source runs the other way up.** Its file is named N90W180 and its
 * first row is 89.99 *south* -- checked by reading the coordinate variable
 * rather than trusting the name, after a first run put the Sahara under
 * four kilometres of water. The rows are flipped on the way in so the file
 * this writes really does start at the north-west corner, which is what
 * every other raster here means by row zero.
 *
 * The source is ETOPO 2022 *surface* elevation at 60 arc-seconds, served by
 * NOAA over OPeNDAP. Surface and not bedrock, which was the first choice and
 * the wrong one: with the ice removed, the basins under East Antarctica read
 * as ocean, and the boat could be sailed a thousand miles under the ice
 * sheet. What this grid is asked is "can she float here", and the answer at
 * an ice shelf is no. Fetched *strided* rather than downloaded whole -- the
 * full 60-arcsecond grid is 466 MB of HDF5, and the server will subsample it
 * for us, which is the entire reason this script is fifty lines instead of a
 * netCDF reader.
 *
 * Run when the grid needs rebuilding, not on install: the output is checked
 * in, because a build that depends on a government server being up is a
 * build that fails on a Sunday.
 */
import { writeFileSync } from 'node:fs';

const SRC =
  'https://www.ngdc.noaa.gov/thredds/dodsC/global/ETOPO2022/60s/60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc';

/** The source grid: 60 arc-seconds, north-west origin. */
const SRC_ROWS = 10800;
const SRC_COLS = 21600;

const arcmin = Number(process.argv[2] ?? 4);
const stride = Math.round(arcmin);
if (!Number.isInteger(stride) || stride < 1 || stride > 60) {
  throw new Error(`arc-minutes must be a whole number of source minutes, got ${process.argv[2]}`);
}

const rows = Math.ceil(SRC_ROWS / stride);
const cols = Math.ceil(SRC_COLS / stride);
const out = new Int16Array(rows * cols);

/** How many rows to ask for at once. Small enough that a stall costs little. */
const BAND = 200;

async function slab(row0: number, rowCount: number): Promise<Float32Array> {
  const last = Math.min(SRC_ROWS - 1, (row0 + rowCount - 1) * stride);
  const query = `z%5B${row0 * stride}:${stride}:${last}%5D%5B0:${stride}:${SRC_COLS - 1}%5D`;
  const res = await fetch(`${SRC}.dods?${query}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for rows ${row0}+${rowCount}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  // DAP2 binary: an ASCII declaration, "Data:\n", then two 32-bit big-endian
  // lengths and the array itself as big-endian float32.
  const marker = 'Data:\n';
  const text = new TextDecoder('latin1').decode(buf.subarray(0, 4096));
  const at = text.indexOf(marker);
  if (at < 0) throw new Error('no Data: marker in the DAP2 response');
  const view = new DataView(buf.buffer, at + marker.length);
  const n = view.getUint32(0);
  const values = new Float32Array(n);
  for (let i = 0; i < n; i++) values[i] = view.getFloat32(8 + i * 4);
  return values;
}

let done = 0;
for (let row = 0; row < rows; row += BAND) {
  const count = Math.min(BAND, rows - row);
  const values = await slab(row, count);
  if (values.length !== count * cols) {
    throw new Error(`expected ${count * cols} samples, got ${values.length}`);
  }
  for (let i = 0; i < values.length; i++) {
    const srcRow = row + Math.floor(i / cols);
    // Flipped: source row 0 is the far south, ours is the far north.
    const dstRow = rows - 1 - srcRow;
    // Metres, rounded, clamped to the int16 range: the deepest trench is
    // -10924 m and the highest ground 8849, so nothing real is lost.
    out[dstRow * cols + (i % cols)] = Math.max(-32768, Math.min(32767, Math.round(values[i])));
  }
  done += count;
  process.stdout.write(`\r${done}/${rows} rows`);
}

const path = `public/terrain/globe-${stride}m.bin`;
writeFileSync(path, Buffer.from(out.buffer));
process.stdout.write(
  `\n${path}: ${cols}x${rows} at ${stride} arc-minute, ${(out.byteLength / 1e6).toFixed(1)} MB\n`,
);
