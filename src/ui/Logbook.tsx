import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Trash2, Upload } from 'lucide-react';
import { fromExport, toExport, type LogStore } from '@/logbook';
import { formatTime, msToKnots } from '@/sim/units';
import { venueById } from '@/sim/venues';
import type { PassageRecord } from '@/sim/passage';

/**
 * The logbook.
 *
 * A record, not a scoreboard. There is no ranking, no personal best and no
 * comparison between passages, because the point of writing a passage down is
 * that it happened -- and a table sorted by speed would quietly turn a calm
 * game back into a race.
 *
 * Ordinary React state: this changes when a passage ends or a file is imported,
 * which is nothing like every frame.
 */

const km = (m: number) => (m < 1000 ? `${m.toFixed(0)} m` : `${(m / 1000).toFixed(2)} km`);

const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

function Entry({ p, onRemove }: { p: PassageRecord; onRemove: () => void }) {
  return (
    <div className="group grid grid-cols-[1fr_auto] items-start gap-2 border-b border-border/60 py-2 last:border-0">
      <div>
        <div className="text-[11px]">
          {venueById(p.venue)?.name ?? 'Open ocean'}
          <span className="ml-2 text-[10px] text-muted-foreground">{when(p.startedAt)}</span>
        </div>
        <div className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {formatTime(p.duration)} · {km(p.distance)} · {msToKnots(p.avgSog).toFixed(1)} kn avg ·{' '}
          {msToKnots(p.maxSog).toFixed(1)} max · {p.windKnots.toFixed(0)} kn wind
          {/*
            How much was tacked, which is the number here a sailor reads first:
            a beat is about 1.4, a reach about 1. Shown only when it means
            something -- a track shorter than the straight line between its own
            ends is impossible for a boat that sailed it, so a record claiming
            one came from an edited file and the ratio is not a fact about a
            passage.
          */}
          {p.direct > 1 && p.distance >= p.direct && (
            <> · {(p.distance / p.direct).toFixed(2)}× the straight line</>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-1.5 opacity-0 transition-opacity group-hover:opacity-100"
        aria-label="Remove"
        onClick={onRemove}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

export function Logbook({ store, version }: { store: LogStore; version: number }) {
  const [passages, setPassages] = useState<PassageRecord[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /**
   * Which read is the newest.
   *
   * The store is async, so two reloads in flight -- an import finishing while a
   * version bump lands, say -- can come back in either order, and the slower one
   * would overwrite the newer answer with an older logbook.
   */
  const generation = useRef(0);

  const reload = useCallback(() => {
    const mine = ++generation.current;
    // Null while loading rather than an empty array, so an empty logbook and a
    // logbook that has not answered yet do not print the same thing.
    store.list().then(
      (rows) => {
        if (mine !== generation.current) return;
        setPassages(rows);
        setProblem(null);
      },
      () => {
        if (mine !== generation.current) return;
        // An empty list rather than a permanent spinner: the reader must not be
        // able to leave the panel saying "reading" forever, which is what an
        // unhandled rejection did.
        setPassages([]);
        setProblem('The logbook could not be read.');
      },
    );
  }, [store]);

  // `version` is bumped by whoever knows a passage was written. Reloading on it
  // rather than polling keeps this asleep for the whole time the menu is shut.
  useEffect(reload, [reload, version]);

  const download = () => {
    const blob = new Blob([JSON.stringify(toExport(passages ?? [], Date.now()), null, 1)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `voyage-logbook-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const upload = (file: File) => {
    void file.text().then(
      async (raw) => {
        const rows = fromExport(raw);
        if (!rows) {
          setProblem('That is not a voyage logbook, or it is a version this cannot read.');
          return;
        }
        try {
          // Added rather than replacing, and keyed on the record's own id, so
          // importing the same file twice is the same logbook and not two of it.
          for (const r of rows) await store.add(r);
          setProblem(null);
        } catch {
          setProblem('Some of that file could not be saved.');
        } finally {
          // Reloaded either way. A partial import has written real rows, and
          // leaving them off the screen would show a logbook that is not the
          // one on disk.
          reload();
        }
      },
      () => setProblem('That file could not be read.'),
    );
  };

  const remove = (id: string) =>
    void store.remove(id).then(
      () => reload(),
      () => {
        setProblem('That passage could not be removed.');
        reload();
      },
    );

  if (passages === null) {
    return <p className="py-4 text-[11px] text-muted-foreground">Reading the logbook…</p>;
  }

  return (
    <div>
      {passages.length === 0 ? (
        <p className="py-3 text-[11px] leading-relaxed text-muted-foreground">
          Nothing logged yet. Click the chart to say where you are bound, sail there, and let
          go the anchor when you arrive — the passage writes itself down.
        </p>
      ) : (
        <div className="max-h-[260px] overflow-y-auto pr-1">
          {passages.map((p) => (
            <Entry
              key={p.id}
              p={p}
              onRemove={() => remove(p.id)}
            />
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={download} disabled={passages.length === 0}>
          <Download /> Export
        </Button>
        <Button variant="outline" size="sm" asChild>
          <label className="cursor-pointer">
            <Upload /> Import
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
                // Cleared so the same file can be picked again after a mistake.
                e.target.value = '';
              }}
            />
          </label>
        </Button>
      </div>
      {/*
        The logbook lives in this browser. Saying so where the export button is
        is the only honest place for it: that button is the answer, and a player
        who never finds it can lose a year of passages to a routine clear of
        site data without ever having been told.
      */}
      {problem && <p className="pt-2 text-[10px] text-destructive">{problem}</p>}
      <p className="pt-2 text-[10px] leading-relaxed text-muted-foreground">
        Kept in this browser only. Export it to keep it — clearing site data will take it.
      </p>
    </div>
  );
}
