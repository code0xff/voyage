import { useCallback, useRef } from 'react';
import {
  Anchor,
  Binoculars,
  Camera,
  Lightbulb,
  Menu,
  Navigation,
  Sailboat,
  Sparkles,
  Video,
} from 'lucide-react';
import { CRUISER } from '@/sim/config';
import type { Snapshot } from '@/engine';
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
 * leaves the helm -- which nothing can do for you -- and a row of the things
 * you actually reach for.
 *
 * The row began as "four keys and no more", and the flare broke the count
 * honestly: the phone was quietly losing not just the fine trim but the
 * *reaching-for* things -- the glasses when a whale blows, the photograph, the
 * lights at dusk. So the row now scrolls. Four and a half keys stand visible
 * -- the half is the affordance, a button cut by the edge says there are more
 * -- and the rest wait off-screen; the sea in front of the helmsman is exactly
 * as clear as it was. The menu key is pinned outside the scroll, so wherever
 * the strip was left, the way out never moves. What stays excluded is what the
 * boat does for herself: reefing, trim, the wind settings. A tablet with a
 * keyboard still loses nothing; a phone now loses only the fine trim, which
 * is the right thing to lose first.
 *
 * Every key goes through `engine.press` into the same bindings the keyboard
 * uses, so a tap and a keystroke are one path to the boat, not two. The two
 * exceptions are the two things that are not keys: the tiller, which is an
 * angle and speaks `setHelm`, and the menu, which belongs to the shell.
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

const KEY_CLASS =
  'pointer-events-auto flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-card/70 text-muted-foreground backdrop-blur-md transition-colors active:bg-accent active:text-foreground disabled:opacity-40 data-[on=true]:border-foreground/40 data-[on=true]:bg-accent data-[on=true]:text-foreground [&_svg]:size-4';

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
    <button type="button" aria-label={label} title={label} onClick={onPress} className={KEY_CLASS}>
      {children}
    </button>
  );
}

/**
 * A key whose binding is an on/off the snapshot knows about, worn on the key
 * itself. The keyboard player sees these states in the instrument panel; a
 * phone hides that panel behind a fold, so without this the lights and the
 * glasses were switches with no position.
 *
 * Written to the DOM off the frame snapshot, not through React state -- the
 * header of this file says what routing per-frame values through the
 * reconciler does to the frame budget.
 */
function StateKey({
  label,
  onPress,
  lit,
  children,
}: {
  label: string;
  onPress: () => void;
  lit: (s: Snapshot) => boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEngineFrame((s) => {
    const el = ref.current;
    if (!el) return;
    // Written only on change: these run every frame, and an unconditional
    // dataset write is a style invalidation the browser has to chew even
    // when nothing moved. aria-pressed rides along -- the state a sighted
    // finger reads off the highlight is the same state a screen reader must
    // hear, which the toggle-group review already taught once.
    const on = lit(s) ? 'true' : 'false';
    if (el.dataset.on !== on) {
      el.dataset.on = on;
      el.setAttribute('aria-pressed', on);
    }
  });
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      data-on="false"
      aria-pressed="false"
      onClick={onPress}
      className={KEY_CLASS}
    >
      {children}
    </button>
  );
}

/**
 * The flare, and only after dark.
 *
 * The chart's recentre-button bargain: a control that appears when it means
 * something and is simply absent when it does not. A flare at noon is a spark
 * nobody can see, so by day the strip closes over the gap; from dusk the key
 * stands, and dims for the minute the locker takes to produce another.
 */
function FlareKey() {
  const engine = useEngine();
  const t = useT();
  const ref = useRef<HTMLButtonElement>(null);
  useEngineFrame((s) => {
    const el = ref.current;
    if (!el) return;
    // 0.4 is dusk, not astronomical night, on purpose: failing light is
    // exactly when a hand starts reaching for a flare, and the threshold
    // was picked so the key arrives with the gloom rather than after it.
    const display = s.sky.daylight < 0.4 ? '' : 'none';
    if (el.style.display !== display) el.style.display = display;
    if (el.disabled === s.flareReady) el.disabled = !s.flareReady;
  });
  return (
    <button
      ref={ref}
      type="button"
      aria-label={t(TOUCH.flare)}
      title={t(TOUCH.flare)}
      onClick={() => engine.press('u')}
      style={{ display: 'none' }}
      className={KEY_CLASS}
    >
      <Sparkles />
    </button>
  );
}

export function TouchControls({ onMenu }: { onMenu: () => void }) {
  const engine = useEngine();
  const t = useT();
  return (
    <div
      /*
       * Lifted off the bottom edge, and by more than it looks like it needs.
       *
       * Two reasons, one of which is invisible on a desktop. A phone's home
       * indicator or gesture bar owns the bottom of the screen, and a control
       * sitting in it is one a swipe-up will take instead: `env()` yields that
       * height where the browser reports it and zero where it does not, so the
       * margin is added to it rather than maxed against it. The other is the
       * thumb -- the very bottom edge of a phone held one-handed is the
       * hardest place on it to land accurately, and the tiller is the control
       * that is dragged rather than tapped.
       */
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.75rem)' }}
      className="pointer-events-none flex w-full flex-col items-center gap-2.5"
    >
      {/* The strip scrolls; the menu does not. Ordered by how often a hand
          reaches: sailing controls first, sightseeing next. The width shows
          four keys and a sliver of the fifth, and the sliver is the whole
          scroll affordance -- an edge-cut button says there are more without
          an arrow saying it. */}
      <div className="flex max-w-[280px] items-center gap-2">
        <div
          className="pointer-events-auto flex items-center gap-2 overflow-x-auto py-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ maxWidth: '13.5rem', WebkitOverflowScrolling: 'touch' }}
        >
          <StateKey
            label={t(TOUCH.autopilot)}
            onPress={() => engine.press('h')}
            lit={(s) => s.pilot.mode !== 'off'}
          >
            <Navigation />
          </StateKey>
          <StateKey
            label={t(TOUCH.anchor)}
            onPress={() => engine.press('a')}
            lit={(s) => s.anchored}
          >
            <Anchor />
          </StateKey>
          <FlareKey />
          <StateKey
            label={t(TOUCH.binoculars)}
            onPress={() => engine.press('b')}
            lit={(s) => s.binoculars}
          >
            <Binoculars />
          </StateKey>
          <Key label={t(TOUCH.camera)} onPress={() => engine.press('c')}>
            <Video />
          </Key>
          <Key label={t(TOUCH.photo)} onPress={() => engine.press('k')}>
            <Camera />
          </Key>
          <StateKey
            label={t(TOUCH.lights)}
            onPress={() => engine.press('l')}
            lit={(s) => s.lightsOn}
          >
            <Lightbulb />
          </StateKey>
          <StateKey
            label={t(TOUCH.sails)}
            onPress={() => engine.press('0')}
            lit={(s) => s.state.stowed}
          >
            <Sailboat />
          </StateKey>
        </div>
        <Key label={t(TOUCH.menu)} onPress={onMenu}>
          <Menu />
        </Key>
      </div>
      <Tiller />
    </div>
  );
}
