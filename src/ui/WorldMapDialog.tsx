import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { createWorldMap, type MapLeg, type WorldMapView } from '@/view/worldmap';
import { loadEarth } from '@/terrain-load';
import { logbook } from '@/logbook';
import { WATERS } from '@/sim/waters';
import { formatLatLon } from '@/sim/globe';
import { mapProject } from '@/sim/earth';
import { useReadout, useEngineFrame } from './engine-context';
import { useT } from './i18n';
import { CHART, WORLDMAP } from './strings';

/**
 * The world map, full screen.
 *
 * Full screen and nothing else, unlike the chart, which is a card that also
 * has a full view. There is no useful small version of this: at a card's 208
 * px the whole Atlantic is forty pixels across and the boat's mark covers
 * Ireland. It is opened, looked at, and closed.
 *
 * The world keeps running behind it, on the same argument the full chart
 * makes: a picture of where you are getting to that stopped you getting there
 * would be a different and much less useful object.
 */

/** Margin round the sheet, px. The map is wide, so this is mostly horizontal. */
const MARGIN = 64;
/** The card's own chrome above and below the sheet, px. Measured, not guessed. */
const CHROME = 92;

/**
 * The largest 2:1 sheet the window will take.
 *
 * Bounded by the height as often as by the width -- a 16:9 window minus the
 * chrome is very nearly 2:1 already -- so both are asked and the smaller wins.
 */
function sheet(): { w: number; h: number } {
  const byWidth = window.innerWidth - MARGIN * 2;
  const byHeight = (window.innerHeight - MARGIN - CHROME) * 2;
  const w = Math.max(320, Math.min(byWidth, byHeight));
  return { w, h: w / 2 };
}

export function WorldMapDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState(sheet);
  const [map, setMap] = useState<WorldMapView | null>(null);
  const [failed, setFailed] = useState(false);
  const passages = useRef<MapLeg[]>([]);
  /**
   * What was last drawn, so a frame that would draw the same thing does not.
   *
   * The chart redraws every frame because everything on it moves -- the wind
   * lattice, the tide, the track. Nothing here does. At 37 km a pixel the
   * boat crosses one every three hours of world time, so the great majority
   * of frames would blit a 1080 px image to produce an identical picture.
   * The position readout is a `useReadout` and updates on its own; this
   * redraws when the mark would actually land somewhere else, or when the
   * sheet is resized.
   */
  const drawn = useRef('');

  // The one shared with the engine and the tests. `loadEarth` keeps a promise
  // for the session, so opening this a second time is free.
  useEffect(() => {
    if (!open || map || failed) return;
    let live = true;
    void loadEarth().then(
      (earth) => live && setMap(createWorldMap(earth)),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [open, map, failed]);

  // The logbook is read on each open rather than held: a passage finished
  // while this was closed should be on it when it opens, and the read is one
  // indexed query against a store that is already warm.
  useEffect(() => {
    if (!open) return;
    let live = true;
    void logbook.list().then(
      (rows) => {
        if (!live) return;
        passages.current = rows.flatMap((r) =>
          // Both ends or neither: a record from before they existed has no
          // latitude to draw, and half a leg is a line to nowhere.
          r.fromPlace && r.toPlace ? [{ from: r.fromPlace, to: r.toPlace }] : [],
        );
        drawn.current = '';
      },
      () => {
        // A logbook that will not open costs the tracks and nothing else. The
        // map is still the answer to where she is, which is what it is for.
        if (live) passages.current = [];
      },
    );
    return () => {
      live = false;
    };
  }, [open]);

  /*
   * Resize only. Escape is not handled here and must not be: the engine owns
   * that key and `App` settles what it backs out of, in one place, so that it
   * always means "the thing in front of me". A listener here as well meant
   * both fired -- the map closed and the menu opened behind it, over a map
   * that was still there.
   */
  useEffect(() => {
    if (!open) return;
    const onResize = () => setSize(sheet());
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  /**
   * Size the canvas as it attaches, rather than from an effect keyed on the
   * size.
   *
   * The sheet is unmounted while the map is closed, so every opening gets a
   * fresh canvas -- at the default 300 by 150 and with no transform until
   * something sets one. An effect cannot be relied on to: the component
   * itself never unmounts, only its tree, so its deps still apply and
   * `[size, map]` are both unchanged between one opening and the next. It
   * worked only because the open effect calls `setSize` with a freshly built
   * object whose identity is always new, which is a coincidence and not a
   * design -- comparing the two sizes before setting state, an obvious
   * tidy-up, would have left the map blank on every reopening.
   *
   * A ref callback runs when the element arrives, which is exactly the event
   * that matters. React re-runs it when its own identity changes, so the
   * resize is covered by the same code.
   */
  const attach = useCallback(
    (c: HTMLCanvasElement | null) => {
      ref.current = c;
      if (!c) return;
      const dpr = Math.min(devicePixelRatio, 2);
      c.width = size.w * dpr;
      c.height = size.h * dpr;
      // setTransform rather than scale, for the reason the chart gives: this
      // must not depend on the transform it happens to inherit.
      c.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawn.current = '';
    },
    [size],
  );

  const where = useReadout<HTMLSpanElement>((s) => formatLatLon(s.place));

  useEngineFrame((s) => {
    const c = ref.current;
    if (!c || !map) return;
    const { x, y } = mapProject(s.place, size.w, size.h);
    // Position only. A passage set that arrives later clears `drawn` itself,
    // which is the one other thing that can change while this is open.
    const key = `${Math.round(x)},${Math.round(y)}`;
    if (key === drawn.current) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    drawn.current = key;
    map.draw(ctx, size.w, size.h, {
      place: s.place,
      departures: WATERS.map((w) => w.place),
      passages: passages.current,
    });
  });

  if (!open) return null;

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-background/70 backdrop-blur-sm"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Card className="gap-0 p-3 backdrop-blur-md bg-card/95 shadow-lg">
        <div className="flex items-center justify-between gap-2 pb-1.5">
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {t(WORLDMAP.title)}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-muted-foreground">{t(CHART.escToClose)}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 [&_svg]:size-3"
              aria-label={t(WORLDMAP.close)}
              title={t(WORLDMAP.close)}
              onClick={onClose}
            >
              <X />
            </Button>
          </div>
        </div>
        {failed ? (
          <div
            className="flex items-center justify-center text-[11px] text-muted-foreground"
            style={{ width: size.w, height: size.h }}
          >
            {t(WORLDMAP.unavailable)}
          </div>
        ) : (
          <canvas ref={attach} className="block" style={{ width: size.w, height: size.h }} />
        )}
        {/* The legend and the position on one line under the sheet: what the
            marks mean, and the number the picture is the answer to. */}
        <div className="flex items-baseline justify-between gap-3 pt-1.5 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-3">
            <span className="text-info">{t(WORLDMAP.you)}</span>
            <span>{t(WORLDMAP.departures)}</span>
            <span>{t(WORLDMAP.passages)}</span>
          </span>
          <span ref={where} className="tabular-nums text-foreground" />
        </div>
      </Card>
    </div>
  );
}
