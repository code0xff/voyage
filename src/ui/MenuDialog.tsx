import { useState } from "react";
import {
  Anchor,
  ArrowLeft,
  BookOpen,
  Compass,
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
import { WEATHER_KINDS, WEATHER_LABEL, type WeatherKind } from "@/sim/weather";
import { withVenue, withoutVenue, type Settings } from "@/settings";
import { VENUES, venueById } from "@/sim/venues";
import { Logbook } from "./Logbook";
import type { LogStore } from "@/logbook";
import { cn } from "@/lib/utils";

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

export function MenuDialog({
  open,
  onOpenChange,
  settings,
  onSettings,
  onPutToSea,
  canResume,
  logbook,
  logVersion,
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
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    onSettings({ ...settings, [k]: v });

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
            <span className="text-base font-medium">Settings</span>
          </span>
        )
      }
      description={
        view === "play" ? (
          <span className="block text-[11px] leading-relaxed">
            A sailing simulator that computes apparent wind, sail lift, keel side
            force and wave-making resistance. Wind differs from place to place,
            weather turns, and land steals your breeze.
          </span>
        ) : undefined
      }
      footer={
        view === "play" ? undefined : (
          // Developer trivia, and the seed, belong where someone is already
          // looking at settings -- not in front of a player trying to start.
          <div className="flex w-full items-center justify-between">
            <Badge variant="outline" className="text-[10px] font-normal">
              physics core runs headless · npm run polar
            </Badge>
            <Button size="sm" onClick={() => setView("play")}>
              Done
            </Button>
          </div>
        )
      }
    >
      {/* Every dialog needs one, and this one had none: it closed on Escape or
          a click outside, both of which have to be guessed. It is not a
          substitute for Resume. This says "put this window away"; Resume says
          "your race is still out there, go back to it", and when there is a
          race running that is the likeliest thing anyone wants and belongs on
          a full-width button rather than in a corner. */}
      <button
        type="button"
        aria-label="Close"
        onClick={() => onOpenChange(false)}
        className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <X className="size-4" />
      </button>

      <div>
        {view === "play" && (
          <>
            {/* Going back to a session in progress is the likeliest thing
                anyone here wants, so it leads and it is the wide one. The two
                below it both throw that session away, which is why they are
                not sitting in the same row as it. */}
            <div className="space-y-2">
              <Button
                variant={canResume ? "secondary" : "default"}
                className="w-full justify-between"
                onClick={onPutToSea}
              >
                <span className="flex items-center gap-2">
                  <Compass /> Put to sea
                </span>
                <span className="font-normal opacity-60">a new world, and time to sail it</span>
              </Button>
            </div>

            {/* What you are about to sail in, in one glance. The knobs behind
                it are worth having, but not worth reading past every time. */}
            <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-border bg-secondary/30 px-3 py-2">
              <div className="text-[11px] leading-relaxed text-muted-foreground">
                <div>
                  {settings.windKnots} kn ·{" "}
                  {settings.weatherMode === "auto"
                    ? "changing weather"
                    : WEATHER_LABEL[settings.weatherMode]}{" "}
                  · {formatClock(settings.startHour)}
                </div>
                <div>
                  {/* A venue sets the island count to zero because it brings its
                      own land, so reading "open sea" off that field alone
                      announced San Francisco as an empty ocean. */}
                  {settings.venue
                    ? (venueById(settings.venue)?.name ?? "open sea")
                    : settings.islandCount === 0
                      ? "open sea"
                      : `${settings.islandCount} islands`}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => setView("settings")}>
                <SlidersHorizontal /> Adjust
              </Button>
            </div>

            <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
              <kbd className="rounded border border-border bg-secondary px-1 py-px font-mono">
                ← →
              </kbd>{" "}
              helm ·{" "}
              <kbd className="rounded border border-border bg-secondary px-1 py-px font-mono">
                H
              </kbd>{" "}
              autopilot ·{" "}
              <kbd className="rounded border border-border bg-secondary px-1 py-px font-mono">
                T
              </kbd>{" "}
              auto-trim ·{" "}
              <kbd className="rounded border border-border bg-secondary px-1 py-px font-mono">
                Esc
              </kbd>{" "}
              this menu
            </p>
          </>
        )}

        <Tabs
          value={tab}
          onValueChange={setTab}
          className={view === "settings" ? "" : "hidden"}
        >
          <TabsList className="w-full">
            <TabsTrigger value="world" className="flex-1">
              <Compass /> World
            </TabsTrigger>
            <TabsTrigger value="conditions" className="flex-1">
              <Wind /> Conditions
            </TabsTrigger>
            <TabsTrigger value="log" className="flex-1">
              <BookOpen /> Log
            </TabsTrigger>
            <TabsTrigger value="keys" className="flex-1">
              <Waves /> Controls
            </TabsTrigger>
          </TabsList>

          <TabsContent value="world" className="mt-4 space-y-2.5">
            <div className="grid grid-cols-[104px_1fr] items-center gap-3">
              <span className="text-[11px] text-muted-foreground">Venue</span>
              <Select
                value={settings.venue || "open"}
                onValueChange={(v) => {
                  const venue = venueById(v);
                  // Picking a place writes its conditions into the settings
                  // rather than overriding them, so every slider below keeps
                  // showing what is actually being sailed and stays live.
                  onSettings(venue ? withVenue(settings, venue) : withoutVenue(settings));
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open ocean (procedural)</SelectItem>
                  {VENUES.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {settings.venue ? (
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                {venueById(settings.venue)?.brief}
                <br />
                <span className="text-warning">
                  Approximate, and not for navigation.
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
                World seed
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
                  {settings.randomWorld ? "New each time" : "Pinned"}
                </Button>
              </div>
            </div>
            <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground">
              {settings.venue
                ? "A venue brings its own land, breeze and tide, so the island slider stands down. The stream runs hardest in deep water and gives up in the shallows — which is where the wind gives up too."
                : "The ocean has no edge: islands keep coming over the horizon for as long as you sail. Their lee is flat water but almost no wind, and the shoals around them will stop you dead. Pin the seed to race the same water twice."}
            </p>
          </TabsContent>

          <TabsContent value="conditions" className="mt-4 space-y-2.5">
            <Slider
              label="Mean wind"
              min={3}
              max={40}
              step={1}
              value={settings.windKnots}
              format={(v) => `${v} kn`}
              onChange={(v) => set("windKnots", v)}
            />
            <Slider
              label="Gusts / shifts"
              min={0}
              max={1}
              step={0.05}
              value={settings.gustiness}
              format={(v) => (v === 0 ? "steady" : `${Math.round(v * 100)}%`)}
              onChange={(v) => set("gustiness", v)}
            />
            <Slider
              label="Sea state"
              min={0}
              max={2}
              step={0.1}
              value={settings.seaScale}
              format={(v) => (v === 0 ? "flat" : `${v.toFixed(1)}x`)}
              onChange={(v) => set("seaScale", v)}
            />
            <Slider
              label="Tidal drift"
              min={0}
              max={4}
              step={0.1}
              value={settings.driftKnots}
              format={(v) => (v === 0 ? "slack" : `${v.toFixed(1)} kn`)}
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
              label="Start time"
              min={0}
              max={23.5}
              step={0.5}
              value={settings.startHour}
              format={(v) => formatClock(v)}
              onChange={(v) => set("startHour", v)}
            />
            <Slider
              label="Time speed"
              min={0}
              max={360}
              step={10}
              value={settings.timeScale}
              format={(v) => (v === 0 ? "frozen" : `${v}x`)}
              onChange={(v) => set("timeScale", v)}
            />
            <div className="grid grid-cols-[104px_1fr] items-center gap-3">
              <span className="text-[11px] text-muted-foreground">Weather</span>
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
                  <SelectItem value="auto">Evolving (random)</SelectItem>
                  {WEATHER_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {WEATHER_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground">
              Evolving weather is what makes two runs of the same course
              different. A squall on the second beat forces a reef and changes
              which side pays.
            </p>
          </TabsContent>

          <TabsContent value="log" className="mt-4">
            <Logbook store={logbook} version={logVersion} />
          </TabsContent>

          <TabsContent value="keys" className="mt-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
              {[
                ["← →  /  A D", "helm (holds its angle)"],
                ["Space", "centre the helm"],
                ["↑ ↓  /  W S", "trim in / ease"],
                ["Z X", "vang: close the leech / twist off"],
                ["T", "auto-trim"],
                ["H", "autopilot: off / compass / wind"],
                ["1 2 3 4", "reef 0–3"],
                ["F / G", "furl / unfurl jib"],
                ["Y", "auto-reef"],
                ["Q E", "mean wind direction"],
                ["C", "camera"],
                ["0", "hand all sail / set again"],
                ["A", "let go / weigh anchor"],
                ["N", "chart range"],
                ["click chart", "set where you are bound"],
                ["drag", "orbit around the boat"],
                ["wheel", "zoom"],
                ["double-click", "recentre astern"],
                ["P", "re-solve polar"],
                ["R", "restart"],
                ["M", "sound"],
                ["L", "navigation lights"],
                ["Esc", "this menu"],
              ].map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-baseline justify-between gap-3"
                >
                  <kbd className="rounded border border-border bg-secondary px-1.5 py-px font-mono text-[10px]">
                    {k}
                  </kbd>
                  <span className="text-muted-foreground">{v}</span>
                </div>
              ))}
            </div>
            <div
              className={cn(
                "mt-4 rounded-md border border-warning/40 bg-warning/10 p-3",
              )}
            >
              <p className="text-[11px] leading-relaxed">
                <span className="font-medium text-warning">
                  You cannot sail at the windward mark.
                </span>{" "}
                Zig-zag up to it at roughly 45° to the wind. The polar panel
                shows the best angle.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </Dialog>
  );
}
