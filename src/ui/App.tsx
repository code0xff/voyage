import { useCallback, useEffect, useRef, useState } from 'react';
import { createEngine, type Engine } from '@/engine';
import { loadSettings, saveSettings, type Settings } from '@/settings';
import { EngineProvider } from './engine-context';
import { Instruments } from './Instruments';
import { PolarCard } from './PolarCard';
import { RaceBar } from './RaceBar';
import { MenuDialog, type RaceResult } from './MenuDialog';
import { HintBar } from './HintBar';
import { MinimapCard } from './MinimapCard';

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
  const [result, setResult] = useState<RaceResult | null>(null);
  const [started, setStarted] = useState(false);

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
      if (ev.type === 'finished') {
        setResult({
          time: ev.time,
          isBest: ev.isBest,
          race: e.snapshot.race,
          course: e.snapshot.course,
          best: e.snapshot.best,
        });
        setMenuOpen(true);
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

  const applySettings = useCallback(
    (next: Settings) => {
      setSettings(next);
      saveSettings(next);
      engine?.applySettings(next);
    },
    [engine],
  );

  const startRace = useCallback(() => {
    engine?.applySettings(settingsRef.current);
    engine?.startRace();
    setResult(null);
    setMenuOpen(false);
    setStarted(true);
  }, [engine]);

  const freeSail = useCallback(() => {
    engine?.applySettings(settingsRef.current);
    engine?.freeSail();
    setResult(null);
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
                <div className="flex-1">
                  <RaceBar />
                </div>
                <PolarCard />
              </div>
              <div className="mt-auto flex items-end justify-between gap-3">
                <HintBar />
                <MinimapCard />
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
        onStartRace={startRace}
        onFreeSail={freeSail}
        result={result}
        canResume={started}
      />
    </div>
  );
}