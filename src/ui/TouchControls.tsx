import { useCallback, useRef } from 'react';
import { Anchor, Menu, Navigation, Video } from 'lucide-react';
import { CRUISER } from '@/sim/config';
import { useEngine, useEngineFrame } from './engine-context';
import { useT } from './i18n';
import { TOUCH } from './strings';

/**
 * Enough of the boat to sail her with a finger.
 *
 * **Deliberately not all of it.** Every binding could have had a button and the
 * screen would then be a control panel with a sea behind it, which is the one
 * thing a sailing game cannot afford. What saves it is that she already sails
 * herself where it does not matter: auto-trim and auto-reef are on by default,
 * so the sheet, the vang and the reef are hands-off unless you want them. That
 * leaves the helm -- which nothing can do for you -- and a short row of the
 * things you actually reach for.
 *
 * The rest stay on the keyboard, and are listed in the Controls tab. A tablet
 * with a keyboard loses nothing by this; a phone loses the fine trim, which is
 * the right thing to lose first.
 *
 * Everything here goes through `engine.press` into the same bindings the keys
 * use, so there is one path from an intention to the boat and not two.
 */

/** How far the tiller reaches either side, px. */
const THROW = 96;

function Tiller() {
  const engine = useEngine();
  const t = useT();
  const track = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const held = useRef(false);

  /*
   * The helm holds its angle, so the control is a thing you *place* rather than
   * a pair of buttons you hold. That is not a UI preference: `ctl.rudder` is an
   * angle the keys nudge and leave, and a slider is already the shape of that.
   * Carrying three degrees of weather helm is a drag of three pixels; with
   * buttons it is a tap you have to keep repeating.
   */
  const set = useCallback(
    (clientX: number) => {
      const el = track.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const mid = r.left + r.width / 2;
      const v = Math.max(-1, Math.min(1, (clientX - mid) / (r.width / 2)));
      engine.setHelm(v);
    },
    [engine],
  );

  // The knob follows the boat's own rudder, not the finger: let go and it stays
  // where the helm actually is, which is also where the autopilot puts it.
  useEngineFrame((s) => {
    const el = knob.current;
    if (!el || held.current) return;
    const v = Math.max(-1, Math.min(1, s.state.rudder / CRUISER.maxRudder));
    el.style.transform = `translate(-50%, -50%) translateX(${v * THROW}px)`;
  });

  return (
    <div
      ref={track}
      className="pointer-events-auto relative h-11 w-full max-w-[280px] touch-none rounded-full border border-border bg-card/70 backdrop-blur-md"
      onPointerDown={(e) => {
        held.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        set(e.clientX);
      }}
      onPointerMove={(e) => {
        if (!held.current) return;
        set(e.clientX);
        const el = knob.current;
        const r = track.current?.getBoundingClientRect();
        if (el && r) {
          const v = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)));
          el.style.transform = `translate(-50%, -50%) translateX(${v * THROW}px)`;
        }
      }}
      onPointerUp={() => {
        held.current = false;
      }}
      onPointerCancel={() => {
        held.current = false;
      }}
      // Both hands off centres her, which is what letting go of a tiller does.
      onDoubleClick={() => engine.setHelm(0)}
      aria-label={t(TOUCH.helm)}
      title={t(TOUCH.centre)}
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
      <div
        ref={knob}
        // Centred in the transform and not in a class: the frame callback
        // writes `style.transform` every frame, which replaces whatever the
        // class put there -- so the offset has to travel with the value.
        style={{ transform: 'translate(-50%, -50%)' }}
        className="absolute left-1/2 top-1/2 size-8 rounded-full bg-foreground/80 shadow"
      />
    </div>
  );
}

function Key({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onPress}
      className="pointer-events-auto flex size-10 items-center justify-center rounded-full border border-border bg-card/70 text-muted-foreground backdrop-blur-md transition-colors active:bg-accent active:text-foreground [&_svg]:size-4"
    >
      {children}
    </button>
  );
}

export function TouchControls({ onMenu }: { onMenu: () => void }) {
  const engine = useEngine();
  const t = useT();
  return (
    <div className="pointer-events-none flex w-full flex-col items-center gap-2">
      {/* Four, and no more. Reefing and trimming are not here because she does
          both herself by default, and a row of buttons for things nobody has to
          press is how a sea turns into a control panel. */}
      <div className="flex items-center gap-2">
        <Key label={t(TOUCH.autopilot)} onPress={() => engine.press('h')}>
          <Navigation />
        </Key>
        <Key label={t(TOUCH.anchor)} onPress={() => engine.press('a')}>
          <Anchor />
        </Key>
        <Key label={t(TOUCH.camera)} onPress={() => engine.press('c')}>
          <Video />
        </Key>
        <Key label={t(TOUCH.menu)} onPress={onMenu}>
          <Menu />
        </Key>
      </div>
      <Tiller />
    </div>
  );
}
