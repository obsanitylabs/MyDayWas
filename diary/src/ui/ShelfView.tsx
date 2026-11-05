import React from "react";
import type { DecryptedEntry } from "../app/api";

export interface ShelfViewProps {
  entries: DecryptedEntry[];
  onDelete: (id: string) => void;
}

function dayLabel(day: number): string {
  const d = new Date(day * 86_400_000);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/**
 * SHELF view — re-read old entries, grouped by UTC day, newest first. This is
 * the original "Your diary (n)" list, lifted out of the single screen.
 */
export function ShelfView({ entries, onDelete }: ShelfViewProps): React.ReactElement {
  const grouped = entries.reduce<Record<number, DecryptedEntry[]>>((acc, e) => {
    (acc[e.day] ??= []).push(e);
    return acc;
  }, {});

  return (
    <section className="view shelf-view" aria-label="Your shelf">
      <h2 className="view-title">Your shelf</h2>
      <p className="hint">
        {entries.length === 0
          ? "Nothing here yet — the entries you write will rest on this shelf."
          : `${entries.length} ${entries.length === 1 ? "entry" : "entries"}, newest first.`}
      </p>
      {Object.entries(grouped)
        .sort((a, b) => Number(b[0]) - Number(a[0]))
        .map(([day, list]) => (
          <div className="daygroup" key={day}>
            <div className="daylabel">{dayLabel(Number(day))}</div>
            {list.map((e) => (
              <div className="entry" key={e.id}>
                <div className="meta">
                  <span className={"sent " + e.sentiment}>{e.sentiment.toLowerCase()}</span>
                  <span className="spacer" />
                  <button className="danger" onClick={() => onDelete(e.id)}>Delete</button>
                </div>
                <p className="text">{e.text}</p>
              </div>
            ))}
          </div>
        ))}
    </section>
  );
}
