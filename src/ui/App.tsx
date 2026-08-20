import { useCallback, useEffect, useRef, useState } from "react";
import type { Engine } from "@/engine";
import { loadSettings, saveSettings, type Settings } from "@/settings";
import { EngineProvider } from "./engine-context";
import { LangProvider } from "./i18n";
import { Instruments } from "./Instruments";
import { PolarCard } from "./PolarCard";
import { MenuDialog } from "./MenuDialog";
import { logbook } from "@/logbook";
import { clearUnderway, loadUnderway, saveUnderway } from "@/underway";
import { waterById } from "@/sim/waters";
import { HintBar } from "./HintBar";
import { BinocularMask } from "./BinocularMask";
import { MinimapCard } from "./MinimapCard";
import { WorldMapDialog } from "./WorldMapDialog";
import { PassageBar } from "./PassageBar";
import { TouchControls } from "./TouchControls";
import { useViewport } from "./viewport";
import { primeAudio } from "@/view/audio-context";

/**
 * The app shell.
 *
 * The canvas is full-bleed and the UI floats over it. Everything here is either
 * layout or state that changes rarely; per-frame values are written straight to
 * the DOM by the panels themselves.
 */
export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [engineLoading, setEngineLoading] = useState(true);
  const [engineError, setEngineError] = useState(false);
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [menuOpen, setMenuOpen] = useState(true);
  /**
   * Whether the chart has the whole screen.
   *
   * Held here rather than in the card because Escape has to be settled in one
   * place. The engine owns the key and emits `toggleMenu`; if the chart is up,
   * that closes the chart instead of opening the menu -- so Escape always means
   * "back out of the thing that is in front of me", and never opens the menu
   * behind an open chart.
   */
  const [chartFull, setChartFull] = useState(false);
  /**
   * The world map, open over everything.
   *
   * Here rather than inside the chart card, because it is not part of the
   * chart: it takes the whole window, it outlives the card on a phone where
   * the card can be folded away, and the chart's range and pan have nothing
   * to do with it. The card only holds the button.
   */
  const [worldOpen, setWorldOpen] = useState(false);
  // Read by the engine's event handler, which is created once. A ref and not
  // the state value, because that closure would otherwise capture `false`
  // forever -- and not a setState updater with another setState inside it,
  // which StrictMode is entitled to run twice and would toggle the menu twice.
  const chartFullRef = useRef(chartFull);
  chartFullRef.current = chartFull;
  const worldOpenRef = useRef(worldOpen);
  worldOpenRef.current = worldOpen;
  /**
   * Whether the map was opened from the menu, so that closing it goes back
   * there rather than dropping you at sea.
   *
   * The menu has to give way to it -- the map takes the whole window and the
   * dialog is drawn over everything -- so opening one closes the other, and
   * without this the way back was gone. Worse before the first departure:
   * the menu cannot be dismissed then, and this was the one path that closed
   * it anyway, which put her to sea from a departure nobody had chosen. That
   * is the door the commit before last shut, reopened by a link added to the
   * menu two commits earlier.
   */
  const worldFromMenu = useRef(false);
  /** Every way out of the world map, so they all go back where it came from. */
  const closeWorldMap = useCallback(() => {
    setWorldOpen(false);
    if (worldFromMenu.current) {
      worldFromMenu.current = false;
      setMenuOpen(true);
    }
  }, []);
  const [started, setStarted] = useState(false);
  /**
   * Bumped when a passage's write has *committed*, so the logbook reloads on it.
   *
   * Committed and not merely requested: a read that goes out beside the write
   * can come back without it, and nothing bumps a second time.
   *
   * A counter rather than the records themselves: they live in IndexedDB behind
   * an async store, and holding a second copy in React would be two answers to
   * one question the moment an import or a delete touched only one of them.
   */
  const [logVersion, setLogVersion] = useState(0);
  const [logbookError, setLogbookError] = useState(false);
  /**
   * The local logbook will not open at all, as opposed to one write failing.
   *
   * Separate state and never opens the menu: it is one standing fact about this
   * session -- true of every passage, and nothing the player can act on -- and
   * reported through the write-failure channel it interrupted the end of every
   * voyage with the same alarm as a passage that really was lost.
   */
  const [logbookUnavailable, setLogbookUnavailable] = useState(false);
  const { compact, touch, height } = useViewport();

  // Keep the latest settings reachable from the engine callbacks without
  // re-creating the engine on every keystroke.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // Keep Three.js out of the menu's initial bundle. The engine is loaded in the
  // background, so a click made before it arrives must not appear to do nothing.
  // Preserve a click made during that short load instead of making the button
  // appear dead while the renderer chunk is arriving.
  const pendingStart = useRef(false);

  useEffect(() => {
    let disposed = false;
    let disposeEngine: (() => void) | null = null;
    let loading: Promise<void> | null = null;
    /**
     * Loaded once, and a failure is recovered by reloading the page rather
     * than by importing again.
     *
     * This used to import `@/engine?retry=1..3` on successive clicks, on the
     * reasoning that a query suffix is a distinct URL and so escapes the
     * browser's cached rejection. The suffix does make a distinct URL, and it
     * does not help: the engine chunk is a 9.7 kB shim whose static imports --
     * the 704 kB renderer and the 432 kB app chunk -- keep their own URLs, and
     * those are the ones a dropped connection actually loses.
     *
     * Measured, in Chromium, with three byte-identical parent modules over one
     * dependency served 503 then 200: the dependency was requested **once**,
     * all three parents failed, and reloading the page fetched it again and
     * succeeded. An errored entry in the module map is reused by every later
     * import of that URL, so no in-page retry of any spelling can work -- and
     * the reload always could.
     */
    const loadEngine = () => {
      if (disposed || disposeEngine || loading) return;
      setEngineLoading(true);
      setEngineError(false);
      loading = import("@/engine")
        .then(({ createEngine }) => {
          if (disposed) return;
          const canvas = canvasRef.current;
          if (!canvas) return;
          const e = createEngine(canvas, settingsRef.current);
          if (disposed) {
            e.dispose();
            return;
          }
          setEngine(e);
          setEngineLoading(false);
          setEngineError(false);

          const offEvent = e.onEvent((ev) => {
            // Escape backs out of whatever is in front: the world map first,
            // then the chart, then the world itself. Never the menu while
            // either sheet is up, which would leave a dialog open behind
            // something the player thought they were closing -- which is
            // exactly what the world map did before it was added to this
            // chain, having brought its own keydown listener instead.
            if (ev.type === "toggleMenu") {
              if (worldOpenRef.current) closeWorldMap();
              else if (chartFullRef.current) setChartFull(false);
              else setMenuOpen((v) => !v);
            }
            // `O`. One sheet at a time: opening the map puts the full chart
            // away, which is the same rule the chart's own globe button states
            // by not being there in the full view. Never a silent no-op --
            // a key that does nothing reads as a broken key, which is the
            // lesson the flare above is already carrying.
            if (ev.type === "worldMap") {
              // Read through the ref and not a setState updater, for the reason
              // given where the refs are declared: StrictMode may run an
              // updater twice, and one with another setState inside it is a
              // side effect in a render-phase function.
              if (worldOpenRef.current) {
                closeWorldMap();
              } else {
                // Pressed at the helm -- the engine reads no keys while the
                // menu is up, because the menu pauses it -- so this one goes
                // back to the sea it came from.
                worldFromMenu.current = false;
                setWorldOpen(true);
                setChartFull(false);
              }
            }
            // On the commit and not on the anchor going down: the record is
            // not in the store until its transaction lands, and a read that
            // goes out any earlier can come back straight past it.
            if (ev.type === "logbookSaved") {
              // Deliberately does not clear `logbookError`. That message says a
              // passage was lost, which stays true however many save after it:
              // clearing it here let a later success quietly retract a warning
              // about a voyage that is still not in the book.
              setLogVersion((v) => v + 1);
            }
            if (ev.type === "logbookError") {
              if (ev.reason === "unavailable") setLogbookUnavailable(true);
              else {
                setLogbookError(true);
                setMenuOpen(true);
              }
            }
            // The engine rolls the world, so the seed shown in the menu has to follow
            // it -- otherwise the field would name a sea the player is not sailing in.
            if (ev.type === "world") {
              setSettings((s) => {
                const next = { ...s, seed: ev.seed };
                saveSettings(next);
                return next;
              });
            }
            if (ev.type === "sound") {
              setSettings((s) => {
                const next = { ...s, sound: ev.on };
                saveSettings(next);
                return next;
              });
            }
            // Same path as the sound toggle, and for the same reason: the value is
            // set out in the view, so the only way it survives a reload is for the
            // view to say so and the owner of the settings to write it down.
            if (ev.type === "photo") {
              // Named for where she was and when, so a folder of these reads as a
              // voyage rather than as `screenshot (14).png`.
              const t = new Date();
              const pad = (n: number) => String(n).padStart(2, "0");
              const stamp = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}`;
              const slug = "earth";
              const url = URL.createObjectURL(ev.blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `voyage-${slug}-${stamp}.png`;
              // In the document, and revoked a task later. Clicking a detached
              // anchor and revoking on the next line works in Chrome and is not
              // promised anywhere: the download has only been *started*, and a
              // browser that had not yet read the blob would cancel it. The timeout
              // is the whole fix -- the URL still goes, just after the read.
              document.body.append(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 0);
              flash.current?.animate(
                [{ opacity: 0.75 }, { opacity: 0 }],
                { duration: 260, easing: "ease-out" },
              );
            }
            if (ev.type === "binocularPower") {
              setSettings((s) => {
                if (s.binocularPower === ev.power) return s;
                const next = { ...s, binocularPower: ev.power };
                saveSettings(next);
                return next;
              });
            }
          });

          const onResize = () => e.resize();
          window.addEventListener("resize", onResize);

          // Development hook. A backgrounded tab freezes requestAnimationFrame, so
          // advance() is how a specific moment gets set up for a screenshot.
          (window as unknown as { voyage: unknown }).voyage = e;

          disposeEngine = () => {
            offEvent();
            window.removeEventListener("resize", onResize);
            e.dispose();
          };

          if (pendingStart.current) {
            pendingStart.current = false;
            e.startAudio();
            e.applySettings(settingsRef.current);
            e.putToSea();
            setMenuOpen(false);
            setStarted(true);
          }
        })
        .catch((error: unknown) => {
          if (!disposed) {
            setEngineLoading(false);
            setEngineError(true);
            setMenuOpen(true);
            console.error("Failed to load the sailing engine", error);
          }
        })
        .finally(() => {
          loading = null;
        });
    };
    loadEngine();

    return () => {
      disposed = true;
      disposeEngine?.();
    };
    // Intentionally runs once: the engine owns its own lifetime and is torn
    // down only when the app unmounts.
  }, []);

  // The world stops while the menu is open. Fiddling with settings should not
  // leave the boat somewhere unexpected when the dialog closes.
  useEffect(() => {
    engine?.setPaused(menuOpen);
  }, [engine, menuOpen]);

  /**
   * One signal that the logbook changed, for every panel that reads it.
   *
   * Arrivals come through the engine, and the log panel's own imports and
   * deletes come through here. Both land on the same counter so that the
   * logbook list and the last-passage row on the front page can never be
   * looking at two different versions of the store.
   */
  const bumpLog = useCallback(() => setLogVersion((v) => v + 1), []);

  /**
   * The engine holds its own copy of the installed packs, so the menu has to
   * tell it when that list changes. Nothing here waits for it: the store is
   * already written by the time this runs, and the engine's next look is two
   * seconds away.
   */
  const reloadQuests = useCallback(() => engine?.reloadQuests(), [engine]);

  const applySettings = useCallback(
    (next: Settings) => {
      setSettings(next);
      saveSettings(next);
      engine?.applySettings(next);
    },
    [engine],
  );

  /**
   * The white blink after a photograph.
   *
   * Animated straight on the element rather than through state: it is a
   * two-hundred-millisecond flicker, and pushing it through the reconciler
   * would re-render the whole shell twice for something React cannot help
   * with. It is also the only sign the shot was taken -- some browsers drop a
   * download in without a word.
   */
  const flash = useRef<HTMLDivElement>(null);

  /**
   * @param world the settings to sail, when they are not the ones React has
   * caught up with yet. "Sail on" moves the world to the voyage being
   * resumed and puts to sea in the same breath, and `settingsRef` is only
   * refreshed when the render after `setSettings` lands -- so without this it
   * re-applied the old ones and rolled a new seed over the world it had just
   * been asked to restore.
   */
  const putToSea = useCallback((world?: Settings) => {
    primeAudio();
    if (!engine) {
      pendingStart.current = true;
      return;
    }
    engine.applySettings(world ?? settingsRef.current);
    engine.putToSea();
    setMenuOpen(false);
    setStarted(true);
  }, [engine]);

  /**
   * Start a new voyage: from the chosen departure, forgetting where the last
   * one got to.
   *
   * The store is written here as well as in the engine, because the menu can
   * be open before the engine exists -- it is loaded on a dynamic import, and
   * the dialog is up first. The engine's own call was optional-chained away
   * in that window, so the position was never changed and the engine, when it
   * finished loading, read the old one and put her back where she had been.
   */
  const newVoyage = useCallback(() => {
    const s = settingsRef.current;
    // Where a new voyage begins: the departure chosen in the settings.
    const from = waterById(s.departure)?.place ?? null;
    if (from) saveUnderway({ seed: s.seed, place: from });
    else clearUnderway();
    engine?.sailFrom(from ? { place: from } : null);
    putToSea();
  }, [engine, putToSea]);

  /**
   * Sail on: the world the last voyage was in, at the seed it was drawn from
   * and the place she had got to.
   *
   * The seed is pinned, since a resumed voyage under a new seed is a
   * different coast. Pinning it turns "a new world every time" off, which is a visible change to a setting the player owns:
   * it is the honest one, because from here on she *is* sailing that world,
   * and the menu shows it as pinned rather than hiding it.
   *
   * The new settings are handed to `putToSea` as well as written, because
   * `settingsRef` only catches up on the render after `setSettings` -- so
   * without it the launch re-applied the old ones and rolled a new seed over
   * the world it had just been asked to restore. Seen in the browser: the
   * boat arrived in the right place under the wrong coast.
   */
  const sailOn = useCallback(() => {
    const row = loadUnderway();
    if (!row) return;
    const next: Settings = { ...settingsRef.current, seed: row.seed, randomWorld: false };
    applySettings(next);
    engine?.sailFrom({ place: row.place });
    putToSea(next);
  }, [applySettings, engine, putToSea]);

  // A reload, because it is the only thing that recovers -- see `loadEngine`.
  const retryEngine = useCallback(() => {
    window.location.reload();
  }, []);

  const onMenuOpenChange = useCallback(
    (open: boolean) => {
      // Without the engine there is no HUD or keyboard shortcut left that can
      // reopen this dialog. Keep the recovery button reachable until loading
      // succeeds; otherwise a transient chunk failure becomes a dead screen.
      if (!open && (!engine || engineLoading || engineError)) return;
      /*
       * And nothing to go back to before she has been put to sea.
       *
       * "Put this window away" needs something behind it, and until a
       * departure is taken there is nothing there but the scene the engine
       * builds so the menu is not sitting on a black canvas. Dismissing it
       * used to drop you into that scene sailing -- a third door beside the
       * two labelled ones, doing something neither of them says, and the only
       * way to be at sea without having chosen where from.
       *
       * One guard for all three ways out, because ✕, Escape and a click on
       * the backdrop all arrive here. The ✕ is hidden as well; a button that
       * does nothing is worse than no button.
       */
      if (!open && !started) return;
      setMenuOpen(open);
    },
    [engine, engineError, engineLoading, started],
  );

  return (
    <LangProvider lang={settings.lang}>
      {/*
        Measured, not `h-screen`. See useViewport: on a phone `100vh` is the
        height with the address bar hidden, so a page sized to it hides its own
        bottom until you scroll -- and this app does not scroll.

        `max-height: 100dvh` is the belt to that brace, and it is there for
        rotation. Turning a phone fires `orientationchange` before the window
        has its new size, and whether anything fires again once it settles is
        not something to rely on: a stale read of 844 applied to a 390 px
        window puts the tiller off the bottom of the screen, with no way to
        ask for it back. `dvh` is the browser's own live figure and needs no
        event at all, so however wrong the measurement is for a moment, the
        page cannot be taller than the window it is in.
      */}
      <div
        style={{ height: height || undefined, maxHeight: '100dvh' }}
        className="relative h-screen w-screen overflow-hidden bg-background"
      >
        <canvas ref={canvasRef} className="block h-full w-full" />

        {/* Sits over everything and catches nothing. Opacity starts at zero, so
            it is invisible until `animate` runs on it. */}
        <div
          ref={flash}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-50 bg-white opacity-0"
        />

        {engine && (
          <EngineProvider value={engine}>
            {/* Over the canvas and under the instruments: the glasses narrow
                the view of the sea, not the reading of it. */}
            <BinocularMask />
            <div className="pointer-events-none absolute inset-0 z-20 p-2 sm:p-3">
              <div className="flex h-full flex-col">
                <div className="flex items-start justify-between gap-2 sm:gap-3">
                  <Instruments compact={compact} />
                  {/*
                    The passage sits here, in the middle at the top, because
                    where you are bound is the question the whole screen is
                    arranged around once there is somewhere to be.

                    `min-w-0` is load-bearing. A flex item will not shrink below
                    its own content, so the moment a destination existed this
                    grew to fit its text and shoved the chart 94 px off the
                    right of a phone -- taking the button that would have closed
                    it with it, which is a trap and not a layout bug. Below it
                    goes on its own row: 223 px of instruments and a 136 px
                    chart already leave 23 px on a 390 px screen, and nothing
                    useful fits in that.
                  */}
                  <div className="min-w-0 flex-1" />
                  {/*
                  The polar and the chart share the right column, matched in
                  width, and hang off the top rather than standing on the
                  bottom.

                  The chart used to sit bottom-right, opposite the hint bar,
                  which reads better -- but bottom-right puts it in the same
                  column of flow as the instruments, and their heights simply
                  add. Measured at 1280x760, the shortest window this game is
                  played on: the instruments run to y 517, leaving 231 px, and
                  the chart card is 254. It does not clip or scroll -- the
                  bottom of it is simply not on the screen.

                  Here the two reference panels sit together and the two live
                  ones -- instruments and hint bar -- sit opposite, and the
                  chart grows downward into space the layout knows is free.

                  On a small screen only the chart survives. Measured at
                  390x844 the pair hung 32 px off the right and covered 62% of
                  the display between them, and of the two it is the chart that
                  answers a question you cannot answer by looking outside. The
                  polar is reference, and reference is what a phone gives up
                  first -- it is still there the moment the window is bigger.
                */}
                  <div className="flex flex-col items-end gap-2 sm:gap-3">
                    {!compact && <PolarCard />}
                    <MinimapCard
                      onWorld={() => {
                        worldFromMenu.current = false;
                        setWorldOpen(true);
                      }}
                      full={chartFull}
                      onFull={setChartFull}
                      compact={compact}
                    />
                    {/* Under the chart, because that is where a destination is
                        set, drawn and cleared -- the passage line is the
                        chart's caption, not a separate announcement. */}
                    <PassageBar />
                  </div>
                </div>
                <div className="mt-auto flex min-w-0 flex-col items-stretch gap-2">
                  {/* The hint bar goes when the tiller comes: one line of prose
                      and a control that wants a thumb are competing for the
                      same strip of screen, and the control wins. */}
                  {!(compact && touch) && (
                    <div className="flex items-end">
                      <HintBar />
                    </div>
                  )}
                </div>
              </div>
              {/*
                Anchored to the bottom of the screen, and deliberately outside
                the column above it.

                In the column it was the last item, so its position was
                whatever was left after everything else had taken what it
                wanted -- and `mt-auto` pushes down only when there is spare
                room. A phone in landscape has none: measured at 844x300 the
                chart column alone is 215 px and the tiller block 114, so the
                stack asked for 351 px of a 300 px window and the helm went
                over the bottom edge. Fifteen pixels at 300, forty-five at 270,
                and no way to steer in either.

                The helm is the one control that cannot be done without -- the
                boat trims and reefs herself, and nothing steers for you unless
                the autopilot is on. So it is pinned to the bottom and the
                things above it are free to be short of room instead. That is
                also the truer model of this HUD: it is clusters in the corners
                of a canvas, not a document that stacks.
              */}
              {touch && (
                <div className="absolute inset-x-0 bottom-0">
                  <TouchControls onMenu={() => setMenuOpen(true)} />
                </div>
              )}
            </div>
            {/* Outside the HUD's `pointer-events-none` padded layer, which is
                the same reason the full chart is: this wants the whole
                window, not the inset the instruments live in. */}
            <WorldMapDialog open={worldOpen} onClose={closeWorldMap} />
          </EngineProvider>
        )}

        <MenuDialog
          open={menuOpen}
          onOpenChange={onMenuOpenChange}
          settings={settings}
          onSettings={applySettings}
          canResume={started}
          logbook={logbook}
          logVersion={logVersion}
          onLogChanged={bumpLog}
          onPacksChanged={reloadQuests}
          logbookError={logbookError}
          logbookUnavailable={logbookUnavailable}
          engineLoading={engineLoading}
          engineError={engineError}
          onRetryEngine={retryEngine}
          onNewVoyage={newVoyage}
          onSailOn={sailOn}
          onWorldMap={() => {
            worldFromMenu.current = true;
            setMenuOpen(false);
            setChartFull(false);
            setWorldOpen(true);
          }}
        />
      </div>
    </LangProvider>
  );
}
