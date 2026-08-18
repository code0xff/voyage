import { useEffect, useState } from "react";
import {
  Anchor,
  ArrowLeft,
  BookOpen,
  Compass,
  Flag,
  FileJson,
  LifeBuoy,
  SlidersHorizontal,
  Waves,
  Wind,
  X,
} from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatClock } from "@/sim/sky";
import { WEATHER_KINDS, type WeatherKind } from "@/sim/weather";
import { LANGS, type Lang } from "@/i18n";
import type { Phrase } from "@/i18n";
import { Rich, useLang, useT } from "./i18n";
import {
  BELT,
  CONTROLS_NOTE,
  KEYS,
  LOG,
  MENU,
  PANEL,
  QUEST,
  SETTINGS_UI,
  TABS,
  offWater,
  WATER_NAME,
  WEATHER,
  WORLD,
} from "./strings";
import {
  type Settings,
} from "@/settings";
import { placeName } from "@/sim/regions";
import { COAST_NAME } from "@/sim/coast";
import { formatLatLon } from "@/sim/globe";
import { loadUnderway } from "@/underway";
import { AT_WATER, NEAR_WATER, WATERS, waterAt, waterById } from "@/sim/waters";
import { beltAt } from "@/sim/climate";
import { Logbook } from "./Logbook";
import { QuestPacks, Quests } from "./Quests";
import { PackGuide } from "./PackGuide";
import { SailingGuide } from "./SailingGuide";
import { Credits } from "./Credits";
import type { LogStore } from "@/logbook";
import type { PassageRecord } from "@/sim/passage";
import { formatDistance, formatDuration, formatWhen } from "@/sim/units";

/** A labelled range control. Sliders read better than numeric inputs for conditions. */
function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="grid grid-cols-[104px_1fr_64px] items-center gap-3">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-foreground
                   [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none
                   [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground"
      />
      <span className="text-right font-mono text-[11px] tabular-nums">
        {format(value)}
      </span>
    </div>
  );
}

/**
 * A tab in the settings strip.
 *
 * The icon sizing is the whole reason this is not just `flex-1`. `Button`
 * carries `[&_svg]:size-3.5`, but `TabsTrigger` carries no svg rule at all, so
 * a lucide icon dropped into one arrived at its own default 24px -- taller than
 * the 26.25px of usable height inside the h-8 track. The active pill therefore
 * stood proud of the track top and bottom, and at the two ends of the strip
 * that left the track's rounded corner showing past the pill's as a grey wedge:
 * "the end is a slightly different colour". Matching Button's sizing here
 * rather than in `tabs.tsx`, which is generated and not ours to edit.
 */
const TAB_TRIGGER = "flex-1 gap-1.5 [&_svg]:size-3.5 [&_svg]:shrink-0";

/** Where the dialog is: the front page, or one of the three places it leads to. */
type View = "play" | "settings" | "help" | "log" | "quests";

/**
 * What each screen is called.
 *
 * Keyed on the view rather than on `string`, so leaving a screen out or
 * misspelling one is a type error. With a loose key both compiled and fell
 * through to a default, which is the failure this heading already had once.
 *
 * This used to read the heading off whichever tab was open, which was a
 * workaround from the days when one strip held two settings, the logbook and
 * two pieces of help: a screen called Settings would have opened on the sailing
 * guide, so it was named for the tab instead to stop the title lying.
 *
 * That strip is gone and every screen is now one kind of thing, so the
 * workaround outlived its reason -- and had turned into a defect of its own,
 * because naming the screen after the open tab printed the same word twice,
 * once as the title and once in the highlighted tab directly beneath it. It
 * also mis-filed the credits, which sit under the settings tabs and belong to
 * the screen: under a heading that said "World" they read as part of the World
 * tab.
 */
const SCREEN_TITLE: Record<Exclude<View, "play">, Phrase> = {
  settings: MENU.settings,
  help: MENU.help,
  log: TABS.log,
  quests: QUEST.title,
};

/**
 * The last passage, on the way in.
 *
 * The opening screen is deliberately not the settings panel (see below), but
 * what was left on it once racing went was a button and a summary of the
 * weather -- a door rather than a place. This is the thing the game now
 * actually accumulates, so it is what the door is worth opening onto: not
 * "here is a game", but "here is where you last got to".
 *
 * A record and not a score, on the same terms as the logbook itself. The last
 * passage rather than the longest or the fastest, no comparison against the
 * ones before it, and nothing here ranks: sorting these by speed is how a calm
 * game quietly turns back into a race.
 *
 * Shown only when there is one. The logbook itself has room to say what a
 * passage is and says it; the front page saying "nothing yet" would be an empty
 * shelf where the point was to have something on it. The quiet line that stands
 * in for this card until then is at the call site.
 *
 * A button for the same reason the key line is one: it is the only thing on the
 * front page that is about the logbook, so it is where someone would ask for
 * the logbook. Reaching it through "Adjust" meant the record of where you have
 * been was filed under changing the weather.
 */
function LastPassage({ p, onOpen }: { p: PassageRecord; onOpen: () => void }) {
  const t = useT();
  const lang = useLang();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-2 block w-full rounded-md border border-border bg-secondary/30 px-3 py-2 text-left transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <div className="flex items-baseline justify-between gap-3 text-[11px] leading-relaxed">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <BookOpen className="size-3.5 shrink-0" />
          {t(PANEL.lastPassage)}
        </span>
        <span className="text-muted-foreground">{formatWhen(p.startedAt, lang)}</span>
      </div>
      <div className="font-mono text-[10px] tabular-nums text-muted-foreground">
        {placeName(p.venue)} ·{" "}
        {formatDistance(p.distance)} · {formatDuration(p.duration)}
      </div>
    </button>
  );
}

function EngineLoadNotice({
  loading,
  failed,
  onRetry,
}: {
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const t = useT();
  if (!loading && !failed) return null;
  return (
    <div
      role={failed ? "alert" : "status"}
      aria-live="polite"
      className={`mt-3 flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-[11px] leading-relaxed ${
        failed
          ? "border-warning/40 bg-warning/10 text-warning"
          : "border-info/40 bg-info/10 text-info"
      }`}
    >
      <span>{t(failed ? MENU.engineLoadFailed : MENU.engineLoading)}</span>
      {failed && (
        <Button variant="outline" size="sm" className="shrink-0" onClick={onRetry}>
          {t(MENU.retryEngine)}
        </Button>
      )}
    </div>
  );
}

/**
 * Where a *new* voyage sets out from.
 *
 * A plain setting, and only that. What it is not is the position a voyage in
 * progress carries: those answer different questions -- "start a new one,
 * from here" and "sail on from where I got to" -- and a player uses both.
 * Holding them in one field meant choosing the Cape and then starting a new
 * voyage put you back off San Francisco, and an hour's sailing quietly
 * replaced the departure you had chosen.
 *
 * The list is the door into the planet: an ocean that may be entered at any
 * point is an ocean with no doors, and a player who wants to sail the Cape
 * should not have to spend a fortnight getting there. Each is named with the
 * belt it sits in, because the belt is what makes one of them a different
 * sail from another.
 */
function Departure({ value, onChoose }: { value: string; onChoose: (id: string) => void }) {
  const t = useT();
  return (
    <div className="grid grid-cols-[104px_1fr] items-center gap-3 pt-0.5">
      <span className="text-[11px] text-muted-foreground">{t(WORLD.departure)}</span>
      <Select value={value} onValueChange={onChoose}>
        <SelectTrigger className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WATERS.map((w) => (
            <SelectItem key={w.id} value={w.id}>
              {t(WATER_NAME[w.id])} — {t(BELT[beltAt(w.place.lat)])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function MenuDialog({
  open,
  onOpenChange,
  settings,
  onSettings,
  canResume,
  logbook,
  logVersion,
  onLogChanged,
  onPacksChanged,
  logbookError,
  logbookUnavailable,
  engineLoading,
  engineError,
  onRetryEngine,
  onNewVoyage,
  onSailOn,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  settings: Settings;
  onSettings: (s: Settings) => void;
  canResume: boolean;
  logbook: LogStore;
  /** Bumped whenever a passage is written, so the log reloads instead of polling. */
  logVersion: number;
  /** Called when the log panel writes to the store, so `logVersion` can follow. */
  onLogChanged: () => void;
  /**
   * Somebody has installed or removed a quest pack.
   *
   * The engine reads the packs once when it starts, and this menu is open
   * over a running engine -- so without telling it, an installed pack
   * notices nothing until the page is reloaded and a removed one goes on
   * completing quests.
   */
  onPacksChanged: () => void;
  logbookError: boolean;
  /** The store never opened. A standing fact, said once and quietly. */
  logbookUnavailable: boolean;
  engineLoading: boolean;
  engineError: boolean;
  onRetryEngine: () => void;
  /** Put to sea from the chosen departure, forgetting where she got to. */
  onNewVoyage: () => void;
  /** Put to sea in the world of the last voyage, where it left off. */
  onSailOn: () => void;
}) {
  const [tab, setTab] = useState("world");
  /** Bumped when a pack is installed or removed, so the screen reloads. */
  const [questVersion, setQuestVersion] = useState(0);
  const [helpTab, setHelpTab] = useState("sailing");
  /**
   * The dialog is a menu and the places it leads to.
   *
   * Everything used to be on the opening screen at once: the way in, and every
   * knob. Sliders are the biggest thing on a page whether or not anyone wants
   * them, so what a first-time player met was a control panel rather than a
   * game, and the buttons that actually start it were just two more rows in it.
   * Settings are a place you go, and going there is one click.
   *
   * The places were then all one screen, which was the same mistake a level
   * down. A five-tab strip behind a button marked "Adjust" held two settings,
   * a logbook and two pieces of help, and the seams showed as workarounds
   * rather than as complaints: the title had to be named for the open tab
   * because a screen called Settings would otherwise open on the sailing
   * guide, and "Adjust" had to force the tab back to World for the same
   * reason. Both of those are gone now, because nothing is filed under a
   * heading it does not belong to.
   *
   * The front page already led straight to all three -- it just arrived by way
   * of a settings screen it had to correct on the way in.
   */
  const [view, setView] = useState<View>("play");
  const t = useT();
  const lang = useLang();
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    onSettings({ ...settings, [k]: v });

  /** What the header says: the screen, never the tab open inside it. */
  // Read only when `view` is not "play", which the title branch below enforces;
  // the map has no entry for it and needs none.
  const heading = view === "play" ? MENU.settings : SCREEN_TITLE[view];
  /** What the two doors say, worked out once. */
  const from = waterById(settings.departure);
  const startsFrom = from ? t(offWater(t(WATER_NAME[from.id]))) : null;
  /*
   * The voyage waiting to be carried on, and where it is.
   *
   * Named by the departure she is nearest, and by her latitude and longitude
   * when she is near none.
   */
  const carried = loadUnderway();
  const near = carried ? waterAt(carried.place, NEAR_WATER) : null;
  const sailsFrom = !carried
    ? ''
    : near
      ? t(offWater(t(WATER_NAME[near.id])))
      : formatLatLon(carried.place);
  /*
   * Not offered when it would be the same door twice: a voyage still sitting
   * at the departure a new one would start from is a new one.
   *
   * Compared against *that* departure and not against any -- the first
   * version asked only whether she was near some water on the list, so a
   * voyage resumed in the Korea Strait was hidden because the Korea Strait is
   * on the list, whatever the new-voyage picker said.
   */
  const at = carried ? waterAt(carried.place, AT_WATER * 4) : null;
  const sameDoor = carried !== null && from !== null && at?.id === from.id;
  const sailsOn = carried !== null && !sameDoor;

  /**
   * The newest passage, or null while the store has not answered and whenever
   * it cannot.
   *
   * `list()` comes back newest first, so this is its head. Reloaded on
   * `logVersion` -- bumped by whoever knows a passage was written -- rather than
   * polled, so it sleeps for the whole time the menu is shut.
   *
   * A failed passage write is shown on the opening page because it is about the
   * passage that just ended, not a problem someone has to discover by opening
   * the logbook later.
   */
  const [last, setLast] = useState<PassageRecord | null>(null);
  useEffect(() => {
    // The store is async and `logVersion` can bump twice in quick succession,
    // so a slower earlier read must not land on top of a newer answer.
    let live = true;
    logbook.list().then(
      (rows) => {
        if (live) setLast(rows[0] ?? null);
      },
      () => {
        if (live) setLast(null);
      },
    );
    return () => {
      live = false;
    };
  }, [logbook, logVersion]);

  return (
    <Dialog
      open={open}
      onClose={() => onOpenChange(false)}
      className="relative max-w-[560px]"
      title={
        view === "play" ? (
          <span className="flex items-center gap-2">
            <Anchor className="size-4 text-info" />
            <span className="text-lg font-medium tracking-[0.2em]">VOYAGE</span>
          </span>
        ) : (
          <span className="flex items-center gap-2">
            {/* This runs the identical `setView("play")` as Done in the footer,
                and it stays anyway.

                Two controls for one action is normally a fault, and the arrow
                was taken out on that argument. It went straight back in on
                use: the two are not interchangeable in the hand even though
                they are in the code. Coming out of a screen you stepped into,
                the reflex is the top-left corner, and a settings panel you can
                leave only by crossing to the far bottom corner reads as one
                that wants something from you first. Done is for when you have
                finished; this is for when you want out.

                It costs a 28-pixel ghost button. That is the right price. */}
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 h-7 px-2"
              onClick={() => setView("play")}
              aria-label={t(MENU.back)}
            >
              <ArrowLeft />
            </Button>
            <span className="text-base font-medium">{t(heading)}</span>
          </span>
        )
      }
      description={
        view === "play" ? (
          <span className="block text-[11px] leading-relaxed">
            {t(MENU.tagline)}
          </span>
        ) : undefined
      }
      footer={
        view === "play" ? undefined : (
          // Developer trivia, and the seed, belong where someone is already
          // looking at settings -- not in front of a player trying to start.
          <div className="flex w-full items-center justify-between">
            {/* Developer trivia, so it stays with the knobs. On the guide or
                the logbook it would be a fact about the build in front of
                someone who came to read something else. */}
            {view === "settings" ? (
              <Badge variant="outline" className="text-[10px] font-normal">
                {t(SETTINGS_UI.headless)}
              </Badge>
            ) : (
              <span />
            )}
            <Button size="sm" onClick={() => setView("play")}>
              {t(MENU.done)}
            </Button>
          </div>
        )
      }
    >
      {/* Every dialog needs one, and this one had none: it closed on Escape or
          a click outside, both of which have to be guessed. It is not a
          substitute for Resume. This says "put this window away"; Resume says
          "your boat is still out there, go back to her", and when there is a
          session running that is the likeliest thing anyone wants and belongs
          on a full-width button rather than in a corner. */}
      <button
        type="button"
        aria-label={t(MENU.close)}
        onClick={() => onOpenChange(false)}
        className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <X className="size-4" />
      </button>

      <div>
        {logbookError && (
          <div
            role="alert"
            className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] leading-relaxed text-destructive"
          >
            {t(LOG.writeFailed)}
          </div>
        )}
        {view === "play" && (
          <>
            {/* Going back to a session in progress is the likeliest thing
                anyone here wants, so it leads and it is the wide one. The one
                below throws that session away, which is why it is not sitting
                in the same row as it. */}
            {/* Both are dead while the engine has failed to load, and saying so
                is better than a button that does nothing: the notice below
                carries the only thing that recovers, which is a reload. They
                stay live while it is merely *loading*, because a click then is
                held and honoured -- see `pendingStart` in App.tsx. */}
            {canResume && (
              <Button
                className="mb-2 w-full justify-between"
                onClick={() => onOpenChange(false)}
                disabled={engineError}
              >
                <span className="flex items-center gap-2">
                  <Anchor /> {t(MENU.resume)}
                </span>
                <span className="opacity-60">Esc</span>
              </Button>
            )}
            <div className="space-y-2">
              {/* Two doors, and each says where it goes. One of them used to
                  be both: the button said "a new world, and time to sail it"
                  over a game that had quietly resumed the last position, so
                  the words and the deed were opposites and there was no way
                  to tell short of sailing and recognising the coast. */}
              {sailsOn && (
                <Button
                  className="w-full justify-between"
                  onClick={onSailOn}
                  disabled={engineError}
                >
                  <span className="flex items-center gap-2">
                    <Compass /> {t(MENU.sailOn)}
                  </span>
                  <span className="truncate pl-3 font-normal opacity-60">{sailsFrom}</span>
                </Button>
              )}
              <Button
                variant={canResume || sailsOn ? "secondary" : "default"}
                className="w-full justify-between"
                onClick={onNewVoyage}
                disabled={engineError}
              >
                <span className="flex items-center gap-2">
                  <Compass /> {t(MENU.putToSea)}
                </span>
                <span className="truncate pl-3 font-normal opacity-60">
                  {startsFrom ?? t(MENU.putToSeaHint)}
                </span>
              </Button>
              <EngineLoadNotice
                loading={engineLoading}
                failed={engineError}
                onRetry={onRetryEngine}
              />
            </div>

            {/* What you are about to sail in, in one glance. The knobs behind
                it are worth having, but not worth reading past every time. */}
            <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-border bg-secondary/30 px-3 py-2">
              <div className="text-[11px] leading-relaxed text-muted-foreground">
                <div>
                  {settings.windKnots} kn ·{" "}
                  {settings.weatherMode === "auto"
                    ? t(MENU.changingWeather)
                    : t(WEATHER[settings.weatherMode])}{" "}
                  · {formatClock(settings.startHour)}
                </div>
                <div>{COAST_NAME}</div>
              </div>
              {/* Opens on World rather than on whichever tab was last left.
                  This used to be a correction -- the strip held the guide and
                  the logbook too, so remembering the tab meant "Adjust" could
                  land on either. Now it only means a settings screen opens at
                  its first tab, which is all it ever should have meant. */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setTab("world");
                  setView("settings");
                }}
              >
                <SlidersHorizontal /> {t(MENU.adjust)}
              </Button>
            </div>

            {/* On the front page, and not only as a tab behind "Adjust".
                Someone who has never sailed is not looking for a guide under a
                button that says it changes the weather, and they are exactly
                who it is for -- so the one line that admits the boat will not
                do the obvious thing sits where they will actually be.

                Drawn as a line and not as a card, like the two doors below it.
                It had a border once, for emphasis, and that put it in the same
                shape as the conditions panel directly above -- same height,
                same radius, eight pixels apart, and the panel is not clickable
                while this is. Worse, the panel's border was the stronger of the
                two, so the shape that could be pressed was the fainter one. The
                emphasis was never coming from the border anyway; it comes from
                the lead line. */}
            <button
              type="button"
              onClick={() => {
                setHelpTab("sailing");
                setView("help");
              }}
              className="mt-3 block w-full rounded-md px-1 py-1 text-left text-[11px] leading-relaxed text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <span className="font-medium text-foreground">
                {t(MENU.guideLead)}
              </span>{" "}
              {t(MENU.guideBody)}
            </button>

            {/* Under the conditions rather than over them: what you are about
                to sail in is the more useful of the two with a hand already on
                the door, and where you last got to is the reason to open it. */}
            {/* One of these always renders, because the logbook stopped being
                a tab and this is now the only door to it. While it was in the
                strip a first-time player found it by reading the tabs; the
                card below is deliberately not shown empty, so without the line
                beside it the one player who most needs telling what a passage
                is would have had no way in at all. */}
            {last ? (
              <LastPassage p={last} onOpen={() => setView("log")} />
            ) : (
              <button
                type="button"
                onClick={() => setView("log")}
                className="mt-2 block w-full rounded-md px-1 py-1 text-left text-[10px] leading-relaxed text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {t(MENU.logbookLead)}{" "}
                <span className="text-foreground">{t(MENU.logbook)}</span>
              </button>
            )}

            {/* Beside the logbook, because it answers the same kind of
                question -- what have I done -- and belongs nowhere near the
                buttons that put her to sea. */}
            <button
              type="button"
              onClick={() => setView("quests")}
              className="block w-full rounded-md px-1 py-1 text-left text-[10px] leading-relaxed text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <span className="text-foreground">{t(QUEST.see)} →</span>
            </button>

            {/* Here rather than at the top of the dialog, where it started.
                Up there it sat above "Put to sea" -- the most prominent slot in
                the menu given to the quietest message in it, and a message
                about the passage just finished parked above the button that
                starts the next one.

                Down here it lands on the line it contradicts. Whichever of the
                two above is showing says the same thing: every passage you
                finish is written down. That is currently false, and a
                correction reads as a correction when it is next to the promise.

                Only the quiet one moved. A lost passage is urgent and about one
                voyage, so it keeps the top. */}
            {logbookUnavailable && !logbookError && (
              <p
                role="status"
                className="mt-2 rounded-md border border-muted bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground"
              >
                {t(LOG.unavailable)}
              </p>
            )}

            {/* The four keys worth knowing, and a way to the rest of them.
                They used to live only behind "Adjust", which is a button about
                the weather -- nobody looking for the controls would open it,
                and the line that shows four of them is the obvious place to
                ask for all of them. */}
            <button
              type="button"
              onClick={() => {
                setHelpTab("keys");
                setView("help");
              }}
              className="mt-3 block w-full rounded-md px-1 py-1 text-left text-[10px] leading-relaxed text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Rich text={t(MENU.quickKeys)} />{" "}
              <span className="text-foreground">{t(MENU.allKeys)}</span>
            </button>
          </>
        )}

        {/* Three destinations, each one kind of thing. Kept mounted and
            hidden rather than swapped, so that stepping out to the guide and
            back does not reload the logbook or lose a half-set slider. */}
        <Tabs
          value={tab}
          onValueChange={setTab}
          className={view === "settings" ? "" : "hidden"}
        >
          <TabsList className="w-full">
            <TabsTrigger value="world" className={TAB_TRIGGER}>
              <Compass /> {t(TABS.world)}
            </TabsTrigger>
            <TabsTrigger value="conditions" className={TAB_TRIGGER}>
              <Wind /> {t(TABS.conditions)}
            </TabsTrigger>
            {/* A pack is somebody else's file that changes what the game
                notices, which makes it a setting and not a record. What you
                have *done* with one is the screen behind "See the quests". */}
            <TabsTrigger value="quests" className={TAB_TRIGGER}>
              <Flag /> {t(TABS.quests)}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="world" className="mt-4 space-y-2.5">
            {/* First row of the first tab. Someone who opened the settings
                because the game is in the wrong language should not have to
                read three more rows of it to find this. */}
            <div className="grid grid-cols-[104px_1fr] items-center gap-3">
              <span className="text-[11px] text-muted-foreground">
                {t(MENU.language)}
              </span>
              {/* A select rather than a row of buttons: two languages fit as
                  buttons and five would not, and the control should not have to
                  be rebuilt the first time one is added. */}
              <Select value={lang} onValueChange={(v) => set("lang", v as Lang)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGS.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* One world, so there is nothing to choose between: what used
                to be a Where control is now a sentence saying where you are,
                and the only choice left is which coast to leave from. */}
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              {t(WORLD.coastBrief)}
              <br />
              <span className="text-info">{t(WORLD.earthLead)}</span>{" "}
              {t(WORLD.earthBody)}
            </p>
            <Departure value={settings.departure} onChoose={(id) => set("departure", id)} />
            <div className="grid grid-cols-[104px_1fr] items-center gap-3">
              <span className="text-[11px] text-muted-foreground">
                {t(WORLD.seedCoast)}
              </span>
              <div className="flex gap-2">
                <input
                  className="h-8 w-full rounded-md border border-input bg-transparent px-2 font-mono text-xs tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                  value={settings.seed}
                  disabled={settings.randomWorld}
                  onChange={(e) => set("seed", Number(e.target.value) || 1)}
                />
                <Button
                  variant={settings.randomWorld ? "default" : "outline"}
                  size="sm"
                  className="shrink-0"
                  onClick={() => set("randomWorld", !settings.randomWorld)}
                >
                  {settings.randomWorld
                    ? t(WORLD.seedNew)
                    : t(WORLD.seedPinned)}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-[104px_1fr] items-center gap-3">
              <span className="text-[11px] text-muted-foreground">
                {t(WORLD.cruise)}
              </span>
              {/* Both states on show rather than one button whose label is
                  the state: a lone "Off" reads as a caption as easily as a
                  control. A real toggle group (see toggle-group.tsx), the
                  fourth and final shape of this control: the joined look of
                  a button group with Radix carrying the radio contract the
                  hand-joined pair could not. The empty-string guard is the
                  primitive's one sharp edge -- a single-type group reports
                  deselection as "", and a mode must always be one or the
                  other. */}
              <ToggleGroup
                type="single"
                value={settings.cruise ? "on" : "off"}
                onValueChange={(v) => {
                  if (v) set("cruise", v === "on");
                }}
                aria-label={t(WORLD.cruise)}
                // Sized to its two words and left-aligned with the controls
                // above it: a mode switch that spanned the panel announced
                // itself as the most important thing on the tab, which it is
                // not. h-7 matches the seed's own button beside it.
                className="h-7 w-fit"
              >
                <ToggleGroupItem value="off" size="sm">
                  {t(WORLD.cruiseOff)}
                </ToggleGroupItem>
                <ToggleGroupItem value="on" size="sm">
                  {t(WORLD.cruiseOn)}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            {/* Below the row, full width, like every other note on this tab --
                beside the buttons it was squeezed into a sliver and read as
                part of the control. */}
            {settings.cruise && (
              <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground">
                {t(WORLD.cruiseNote)}
              </p>
            )}
            <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground">
              {/* One world, one note. There were three, chosen off a field
                  each world set differently, and the wrong one promised
                  islands over the horizon at a place whose coastline was
                  fixed and measured. */}
              {t(WORLD.coastNote)}
            </p>
          </TabsContent>

          <TabsContent value="conditions" className="mt-4 space-y-2.5">
            <Slider
              label={t(SETTINGS_UI.meanWind)}
              min={3}
              max={40}
              step={1}
              value={settings.windKnots}
              format={(v) => `${v} kn`}
              onChange={(v) => set("windKnots", v)}
            />
            <Slider
              label={t(SETTINGS_UI.gusts)}
              min={0}
              max={1}
              step={0.05}
              value={settings.gustiness}
              format={(v) => (v === 0 ? t(SETTINGS_UI.steady) : `${Math.round(v * 100)}%`)}
              onChange={(v) => set("gustiness", v)}
            />
            <Slider
              label={t(SETTINGS_UI.seaState)}
              min={0}
              max={2}
              step={0.1}
              value={settings.seaScale}
              format={(v) => (v === 0 ? t(SETTINGS_UI.flat) : `${v.toFixed(1)}x`)}
              onChange={(v) => set("seaScale", v)}
            />
            <Slider
              label={t(SETTINGS_UI.tidalDrift)}
              min={0}
              max={4}
              step={0.1}
              value={settings.driftKnots}
              format={(v) =>
                v === 0 ? t(SETTINGS_UI.slack) : `${v.toFixed(1)} kn`
              }
              onChange={(v) => set("driftKnots", v)}
            />
            {/*
              Pointless to set a direction for water that is not moving, and
              leaving it live would invite the player to work out why turning it
              does nothing.
            */}
            {settings.driftKnots > 0 && (
              <>
                <Slider
                  label={t(SETTINGS_UI.set)}
                  min={0}
                  max={355}
                  step={5}
                  value={settings.setDeg}
                  format={(v) => `${v.toString().padStart(3, "0")}°`}
                  onChange={(v) => set("setDeg", v)}
                />
                {/*
                  Behind the drift for the same reason the set is: a cycle on
                  water that is not moving is a control that does nothing.
                */}
                <Slider
                  label={t(SETTINGS_UI.tideCycle)}
                  min={0}
                  max={24}
                  step={0.5}
                  value={settings.tideHours}
                  format={(v) =>
                    v === 0 ? t(SETTINGS_UI.steadyStream) : `${v.toFixed(1)} h`
                  }
                  onChange={(v) => set("tideHours", v)}
                />
              </>
            )}
            <Slider
              label={t(SETTINGS_UI.wildlife)}
              min={0}
              max={10}
              step={1}
              value={settings.wildlife}
              format={(v) => (v === 0 ? t(SETTINGS_UI.noWildlife) : String(v))}
              onChange={(v) => set("wildlife", v)}
            />
            <Slider
              label={t(SETTINGS_UI.startTime)}
              min={0}
              max={23.5}
              step={0.5}
              value={settings.startHour}
              format={(v) => formatClock(v)}
              onChange={(v) => set("startHour", v)}
            />
            <Slider
              label={t(SETTINGS_UI.timeSpeed)}
              min={0}
              max={360}
              step={10}
              value={settings.timeScale}
              format={(v) => (v === 0 ? t(SETTINGS_UI.frozen) : `${v}x`)}
              onChange={(v) => set("timeScale", v)}
            />
            <div className="grid grid-cols-[104px_1fr] items-center gap-3">
              <span className="text-[11px] text-muted-foreground">
                {t(SETTINGS_UI.weather)}
              </span>
              <Select
                value={settings.weatherMode}
                onValueChange={(v) =>
                  set("weatherMode", v as "auto" | WeatherKind)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">
                    {t(SETTINGS_UI.evolving)}
                  </SelectItem>
                  {WEATHER_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(WEATHER[k])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground">
              {t(WORLD.weatherNote2)}
            </p>
          </TabsContent>

          <TabsContent value="quests" className="mt-4">
            <QuestPacks
              onChanged={() => {
                setQuestVersion((v) => v + 1);
                onPacksChanged();
              }}
            />
          </TabsContent>

          {/* Under the settings tabs and not inside any of them:
              attribution is not a setting, but this is the screen someone
              opens looking for what a game is made of. */}
          <Credits />
        </Tabs>

        {/* How to sail her, and what the keys do. Two halves of one question
            -- someone who cannot make the boat go wants both -- so they are
            one screen with a tab between them rather than two doors off the
            menu that cannot see each other. */}
        <Tabs
          value={helpTab}
          onValueChange={setHelpTab}
          className={view === "help" ? "" : "hidden"}
        >
          <TabsList className="w-full">
            <TabsTrigger value="sailing" className={TAB_TRIGGER}>
              <LifeBuoy /> {t(TABS.sailing)}
            </TabsTrigger>
            <TabsTrigger value="keys" className={TAB_TRIGGER}>
              <Waves /> {t(TABS.controls)}
            </TabsTrigger>
            {/* Writing a pack is the third answer to "how do I do the thing
                this game is for", so it belongs behind the same door -- and a
                guide to the format that only lives in the repository is one
                only people who already found the repository will read. */}
            <TabsTrigger value="packs" className={TAB_TRIGGER}>
              <FileJson /> {t(TABS.packs)}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="sailing" className="mt-4">
            <SailingGuide />
          </TabsContent>

          <TabsContent value="keys" className="mt-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
              {KEYS.map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-baseline justify-between gap-3"
                >
                  <kbd className="rounded border border-border bg-secondary px-1.5 py-px font-mono text-[10px]">
                    {k}
                  </kbd>
                  <span className="text-muted-foreground">{t(v)}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
              {t(CONTROLS_NOTE)}
            </p>
          </TabsContent>

          <TabsContent value="packs" className="mt-4">
            <PackGuide />
          </TabsContent>
        </Tabs>

        {/* The logbook is one thing and gets no strip. A single tab above a
            panel is a label pretending to be a control. */}
        <div className={view === "log" ? "" : "hidden"}>
            <Logbook
              store={logbook}
              version={logVersion}
              onChanged={onLogChanged}
            />
        </div>

        {/* Read-only, and the same shape as the logbook for the same reason:
            one thing, no strip. Mounted only while it is open, so it reads
            the store when it is looked at rather than holding a copy that
            goes stale while she sails. */}
        {view === "quests" && <Quests version={questVersion} />}
      </div>
    </Dialog>
  );
}
