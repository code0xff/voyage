import { useEffect, useState } from "react";
import {
  Anchor,
  ArrowLeft,
  BookOpen,
  Compass,
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
import { formatClock } from "@/sim/sky";
import { WEATHER_KINDS, type WeatherKind } from "@/sim/weather";
import { LANGS, type Lang } from "@/i18n";
import { Rich, useLang, useT } from "./i18n";
import {
  CONTROLS_NOTE,
  KEYS,
  MENU,
  PANEL,
  REGION_BRIEF,
  SETTINGS_UI,
  TABS,
  WEATHER,
  WORLD,
} from "./strings";
import {
  withRegion,
  withVenue,
  withoutRegion,
  withoutVenue,
  type Settings,
} from "@/settings";
import { VENUES, venueById } from "@/sim/venues";
import { REGIONS, placeName, regionById } from "@/sim/regions";
import { Logbook } from "./Logbook";
import { SailingGuide } from "./SailingGuide";
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

/** The tab values, which are not all the same word as the labels. */
const TAB_TITLE: Record<string, (typeof TABS)[keyof typeof TABS]> = {
  world: TABS.world,
  conditions: TABS.conditions,
  log: TABS.log,
  sailing: TABS.sailing,
  keys: TABS.controls,
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
 * Shown only when there is one. A first-time player is told what a passage is
 * by the Log tab, which has room to say it; the front page saying "nothing yet"
 * would be an empty shelf where the point was to have something on it.
 */
/**
 * The last passage, and the way to the rest of them.
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
        {placeName(p.venue, (id) => venueById(id)?.name ?? null)} ·{" "}
        {formatDistance(p.distance)} · {formatDuration(p.duration)}
      </div>
    </button>
  );
}

export function MenuDialog({
  open,
  onOpenChange,
  settings,
  onSettings,
  onPutToSea,
  canResume,
  logbook,
  logVersion,
  onLogChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  settings: Settings;
  onSettings: (s: Settings) => void;
  onPutToSea: () => void;
  canResume: boolean;
  logbook: LogStore;
  /** Bumped whenever a passage is written, so the log reloads instead of polling. */
  logVersion: number;
  /** Called when the log panel writes to the store, so `logVersion` can follow. */
  onLogChanged: () => void;
}) {
  const [tab, setTab] = useState("world");
  /**
   * The dialog is two screens, not one.
   *
   * Everything used to be on the opening screen at once: the way in, and every
   * knob. Sliders are the biggest thing on a page whether or not anyone wants
   * them, so what a first-time player met was a control panel rather than a
   * game, and the buttons that actually start it were just two more rows in it.
   * Settings are a place you go, and going there is one click.
   */
  const [view, setView] = useState<"play" | "settings">("play");
  const t = useT();
  const lang = useLang();
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    onSettings({ ...settings, [k]: v });

  /**
   * The newest passage, or null while the store has not answered and whenever
   * it cannot.
   *
   * `list()` comes back newest first, so this is its head. Reloaded on
   * `logVersion` -- bumped by whoever knows a passage was written -- rather than
   * polled, so it sleeps for the whole time the menu is shut.
   *
   * A failure shows nothing rather than an error. The Log tab is where a broken
   * logbook is worth reporting, because that is where someone went to read it;
   * on the way in it would be an alarm about a thing nobody asked for yet.
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
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 h-7 px-2"
              onClick={() => setView("play")}
            >
              <ArrowLeft />
            </Button>
            {/* Named for the tab that is open, not "Settings".
                Two of these five are settings; the others are the logbook and
                two pieces of help, and a screen titled Settings that opens on
                the sailing guide is telling the reader they took a wrong turn
                when they did not. */}
            <span className="text-base font-medium">{t(TAB_TITLE[tab] ?? TABS.world)}</span>
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
            <Badge variant="outline" className="text-[10px] font-normal">
              {t(SETTINGS_UI.headless)}
            </Badge>
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
        {view === "play" && (
          <>
            {/* Going back to a session in progress is the likeliest thing
                anyone here wants, so it leads and it is the wide one. The one
                below throws that session away, which is why it is not sitting
                in the same row as it. */}
            {canResume && (
              <Button
                className="mb-2 w-full justify-between"
                onClick={() => onOpenChange(false)}
              >
                <span className="flex items-center gap-2">
                  <Anchor /> {t(MENU.resume)}
                </span>
                <span className="opacity-60">Esc</span>
              </Button>
            )}
            <div className="space-y-2">
              <Button
                variant={canResume ? "secondary" : "default"}
                className="w-full justify-between"
                onClick={onPutToSea}
              >
                <span className="flex items-center gap-2">
                  <Compass /> {t(MENU.putToSea)}
                </span>
                <span className="font-normal opacity-60">
                  {t(MENU.putToSeaHint)}
                </span>
              </Button>
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
                <div>
                  {/* A venue sets the island count to zero because it brings its
                      own land, so reading "open sea" off that field alone
                      announced San Francisco as an empty ocean. */}
                  {settings.region
                    ? (regionById(settings.region)?.name ?? "open sea")
                    : settings.venue
                      ? (venueById(settings.venue)?.name ?? "open sea")
                      : settings.islandCount === 0
                        ? "open sea"
                        : `${settings.islandCount} islands`}
                </div>
              </div>
              {/* Explicitly to World, not to whichever tab was open last.
                  Left to remember, "Adjust" could land on the sailing guide,
                  which is the same wrong turn this screen used to take. */}
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
                do the obvious thing sits where they will actually be. */}
            <button
              type="button"
              onClick={() => {
                setTab("sailing");
                setView("settings");
              }}
              className="mt-2 w-full rounded-md border border-border/60 px-3 py-2 text-left text-[11px] leading-relaxed text-muted-foreground transition-colors hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <span className="font-medium text-foreground">
                {t(MENU.guideLead)}
              </span>{" "}
              {t(MENU.guideBody)}
            </button>

            {/* Under the conditions rather than over them: what you are about
                to sail in is the more useful of the two with a hand already on
                the door, and where you last got to is the reason to open it. */}
            {last && (
              <LastPassage
                p={last}
                onOpen={() => {
                  setTab("log");
                  setView("settings");
                }}
              />
            )}

            {/* The four keys worth knowing, and a way to the rest of them.
                They used to live only behind "Adjust", which is a button about
                the weather -- nobody looking for the controls would open it,
                and the line that shows four of them is the obvious place to
                ask for all of them. */}
            <button
              type="button"
              onClick={() => {
                setTab("keys");
                setView("settings");
              }}
              className="mt-3 block w-full rounded-md px-1 py-1 text-left text-[10px] leading-relaxed text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Rich text={t(MENU.quickKeys)} />{" "}
              <span className="text-foreground">{t(MENU.allKeys)}</span>
            </button>
          </>
        )}

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
            <TabsTrigger value="log" className={TAB_TRIGGER}>
              <BookOpen /> {t(TABS.log)}
            </TabsTrigger>
            <TabsTrigger value="sailing" className={TAB_TRIGGER}>
              <LifeBuoy /> {t(TABS.sailing)}
            </TabsTrigger>
            <TabsTrigger value="keys" className={TAB_TRIGGER}>
              <Waves /> {t(TABS.controls)}
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
            {/*
              One list, three kinds of world, because "where am I sailing" is
              one question and splitting it across two controls would invite
              picking a region and a venue at once. The groups are labelled by
              how true the land is, which is the only difference that matters:
              a region is surveyed, a venue is a sketch that reproduces the
              decisions rather than the geography.
            */}
            <div className="grid grid-cols-[104px_1fr] items-center gap-3">
              <span className="text-[11px] text-muted-foreground">
                {t(WORLD.where)}
              </span>
              <Select
                value={
                  settings.region
                    ? `region:${settings.region}`
                    : settings.venue || "open"
                }
                onValueChange={(v) => {
                  if (v.startsWith("region:")) {
                    const region = regionById(v.slice(7));
                    if (region) onSettings(withRegion(settings, region));
                    return;
                  }
                  const venue = venueById(v);
                  // Picking a place writes its conditions into the settings
                  // rather than overriding them, so every slider below keeps
                  // showing what is actually being sailed and stays live.
                  onSettings(
                    withoutRegion(
                      venue
                        ? withVenue(settings, venue)
                        : withoutVenue(settings),
                    ),
                  );
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open ocean (procedural)</SelectItem>
                  {REGIONS.map((r) => (
                    <SelectItem key={r.id} value={`region:${r.id}`}>
                      {r.name} — {t(WORLD.surveyedTag)}
                    </SelectItem>
                  ))}
                  {VENUES.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name} — {t(WORLD.sketchTag)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {settings.region ? (
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                {REGION_BRIEF[settings.region]
                  ? t(REGION_BRIEF[settings.region])
                  : regionById(settings.region)?.brief}
                <br />
                <span className="text-success">
                  {t(WORLD.surveyedLead)}
                </span>{" "}
                {t(WORLD.surveyedBody)}{" "}
                {regionById(settings.region)?.source}
                {t(WORLD.surveyedCaveat)}
              </p>
            ) : settings.venue ? (
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                {venueById(settings.venue)?.brief}
                <br />
                <span className="text-warning">
                  {t(WORLD.sketchWarning)}
                </span>{" "}
                The land, depths and stream are a sketch meant to reproduce the
                decisions the place asks of you, not its geography.
              </p>
            ) : (
              <Slider
                label="Islands"
                min={0}
                max={10}
                step={1}
                value={settings.islandCount}
                format={(v) => (v === 0 ? "open sea" : `${v}/10`)}
                onChange={(v) => set("islandCount", v)}
              />
            )}
            <div className="grid grid-cols-[104px_1fr] items-center gap-3">
              <span className="text-[11px] text-muted-foreground">
                {t(WORLD.seed)}
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
            <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground">
              {settings.venue ? t(WORLD.venueNote) : t(WORLD.oceanNote)}
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
              format={(v) => (v === 0 ? "steady" : `${Math.round(v * 100)}%`)}
              onChange={(v) => set("gustiness", v)}
            />
            <Slider
              label={t(SETTINGS_UI.seaState)}
              min={0}
              max={2}
              step={0.1}
              value={settings.seaScale}
              format={(v) => (v === 0 ? "flat" : `${v.toFixed(1)}x`)}
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
              <Slider
                label="Set (towards)"
                min={0}
                max={355}
                step={5}
                value={settings.setDeg}
                format={(v) => `${v.toString().padStart(3, "0")}°`}
                onChange={(v) => set("setDeg", v)}
              />
            )}
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

          <TabsContent value="log" className="mt-4">
            <Logbook
              store={logbook}
              version={logVersion}
              onChanged={onLogChanged}
            />
          </TabsContent>

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
        </Tabs>
      </div>
    </Dialog>
  );
}
