/**
 * Where the static files are, under whatever path the app is served from.
 *
 * The assets and the terrain rasters are fetched at runtime rather than
 * imported, so Vite never sees those strings and never rewrites them. Written
 * as `/assets/...` they resolve against the origin, which is right when the app
 * is served from the root and wrong everywhere else -- on a project page at
 * `example.github.io/voyage/` every model, every attribution notice and the
 * planet's own raster come back as the index page or a 404.
 *
 * `BASE_URL` is what Vite substitutes for the `base` it was built with, and it
 * always ends in a slash.
 */

/**
 * Join a base to a root-relative path.
 *
 * Separated from `assetUrl` so it can be tested against bases other than the
 * one the test runner happens to be built with, which is always `/` -- and `/`
 * is the one base under which getting this wrong changes nothing.
 */
export const joinBase = (base: string, path: string): string =>
  `${base.endsWith('/') ? base : `${base}/`}${path.replace(/^\/+/, '')}`;

/** A runtime-fetched file's URL, wherever the app is deployed. */
export const assetUrl = (path: string): string => joinBase(import.meta.env.BASE_URL, path);
