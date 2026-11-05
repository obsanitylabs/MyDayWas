import React from "react";
import type { DecryptedEntry, Sentiment } from "../app/api";
import { computeStats } from "./stats";

export interface StatsViewProps {
  entries: DecryptedEntry[];
}

const MIX_ROWS: Array<{ key: Sentiment; label: string }> = [
  { key: "POSITIVE", label: "positive" },
  { key: "NEGATIVE", label: "negative" },
  { key: "NEUTRAL", label: "neutral" },
];

/**
 * NUMBER-SIGN (#) view — personal writing stats, computed locally from the
 * decrypted entries already in memory. Nothing leaves the device.
 */
export function StatsView({ entries }: StatsViewProps): React.ReactElement {
  const stats = computeStats(entries);
  const empty = stats.total === 0;

  return (
    <section className="view stats-view" aria-label="Your numbers">
      <h2 className="view-title">Your numbers</h2>
      <p className="hint">Counted on this device from your saved entries. None of this is sent or shared.</p>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-name">entries</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.distinctDays}</div>
          <div className="stat-name">days written</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.currentStreak}</div>
          <div className="stat-name">day current streak</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.longestStreak}</div>
          <div className="stat-name">day best streak</div>
        </div>
      </div>

      <div className="card">
        <h3 className="stat-section">Sentiment mix</h3>
        {empty ? (
          <p className="hint">Write your first entry to see your mix.</p>
        ) : (
          <>
            <div className="mixbar" role="img" aria-label={`Positive ${stats.sentimentMix.POSITIVE}%, negative ${stats.sentimentMix.NEGATIVE}%, neutral ${stats.sentimentMix.NEUTRAL}%`}>
              {MIX_ROWS.map((row) =>
                stats.sentimentMix[row.key] > 0 ? (
                  <span
                    key={row.key}
                    className={"mix-seg mix-" + row.key.toLowerCase()}
                    style={{ width: `${stats.sentimentMix[row.key]}%` }}
                  />
                ) : null,
              )}
            </div>
            <ul className="mixlegend">
              {MIX_ROWS.map((row) => (
                <li key={row.key}>
                  <span className={"dot dot-" + row.key.toLowerCase()} aria-hidden="true" />
                  {row.label} {stats.sentimentMix[row.key]}% · {stats.bySentiment[row.key]}{" "}
                  {stats.bySentiment[row.key] === 1 ? "entry" : "entries"}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
