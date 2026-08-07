import { useCallback, useEffect, useRef, useState } from 'react';
import { createEngine, type Engine } from '@/engine';
import { loadSettings, saveSettings, type Settings } from '@/settings';
import { EngineProvider } from './engine-context';
import { Instruments } from './Instruments';
import { PolarCard } from './PolarCard';
import { MenuDialog } from './MenuDialog';
import { logbook } from '@/logbook';
import { HintBar } from './HintBar';
import { MinimapCard } from './MinimapCard';
import { PassageBar } from './PassageBar';

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
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [menuOpen, setMenuOpen] = useState(true);
  const [started, setStarted] = useState(false);
  /**
   * Bumped when a passage is written, so the logbook reloads on it.
   *
   * A counter rather than the records themselves: they live in IndexedDB behind
   * an async store, and holding a second copy in React would be two answers to
   * one question the moment an import or a delete touched only one of them.
   */
  const [logVersion, setLogVersion] = useState(0);

  // Keep the latest settings reachable from the engine callbacks without
  // re-creating the engine on every keystroke.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const e = createEngine(canvas, settingsRef.current);
    setEngine(e);

    const offEvent = e.onEvent((ev) => {
      if (ev.type === 'toggleMenu') setMenuOpen((v) => !v);
      if (ev.type === 'arrived') setLogVersion((v) => v + 1);
      // The engine rolls the world, so the seed shown in the menu has to follow
      // it -- otherwise the field would name a sea the player is not sailing in.
      if (ev.type === 'world') {
        setSettings((s) => {
          const next = { ...s, seed: ev.seed };
          saveSettings(next);
          return next;
        });
      }
      if (ev.type === 'sound') {
        setSettings((s) => {
          const next = { ...s, sound: ev.on };
          saveSettings(next);
          return next;
        });
      }
    });

    const onResize = () => e.resize();
    window.addEventListener('resize', onResize);

    // Development hook. A backgrounded tab freezes requestAnimationFrame, so
    // advance() is how a specific moment gets set up for a screenshot.
    (window as unknown as { voyage: unknown }).voyage = e;

    return () => {
      offEvent();
      window.removeEventListener('resize', onResize);
      e.dispose();
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

  const applySettings = useCallback(
    (next: Settings) => {
      setSettings(next);
      saveSettings(next);
      engine?.applySettings(next);
    },
    [engine],
  );

  const putToSea = useCallback(() => {
    engine?.applySettings(settingsRef.current);
    engine?.putToSea();
    setMenuOpen(false);
    setStarted(true);
  }, [engine]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background">
      <canvas ref={canvasRef} className="block h-full w-full" />

      {engine && (
        <EngineProvider value={engine}>
          <div className="pointer-events-none absolute inset-0 p-3">
            <div className="flex h-full flex-col">
              <div className="flex items-start justify-between gap-3">
                <Instruments />
                {/* The passage sits here, in the middle at the top, because
                    where you are bound is the question the whole screen is
                    arranged around once there is somewhere to be. */}
                <div className="flex-1 space-y-2">
                  <PassageBar />
                </div>
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
                */}
                <div className="flex flex-col items-end gap-3">
                  <PolarCard />
                  <MinimapCard />
                </div>
              </div>
              <div className="mt-auto flex items-end">
                <HintBar />
              </div>
            </div>
          </div>
        </EngineProvider>
      )}

      <MenuDialog
        open={menuOpen}
        onOpenChange={setMenuOpen}
        settings={settings}
        onSettings={applySettings}
        onPutToSea={putToSea}
        canResume={started}
        logbook={logbook}
        logVersion={logVersion}
        onLogChanged={bumpLog}
      />
    </div>
  );
}