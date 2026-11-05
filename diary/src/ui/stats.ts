import type { DecryptedEntry, Sentiment } from "../app/api";

export interface DiaryStats {
  total: number;
  distinctDays: number;
  bySentiment: Record<Sentiment, number>;
  /** Share of entries per sentiment, rounded to whole percent (sums to ~100). */
  sentimentMix: Record<Sentiment, number>;
  /** Consecutive UTC days ending at the most recent day with an entry. */
  currentStreak: number;
  longestStreak: number;
  firstDay: number | null;
  lastDay: number | null;
}

const EMPTY_BY_SENTIMENT: Record<Sentiment, number> = { POSITIVE: 0, NEGATIVE: 0, NEUTRAL: 0 };

export function computeStats(entries: DecryptedEntry[]): DiaryStats {
  const total = entries.length;
  const bySentiment: Record<Sentiment, number> = { ...EMPTY_BY_SENTIMENT };
  const daySet = new Set<number>();
  for (const e of entries) {
    bySentiment[e.sentiment] += 1;
    daySet.add(e.day);
  }

  const days = [...daySet].sort((a, b) => a - b);
  const { current, longest } = streaks(days);
  const mix = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100));

  return {
    total,
    distinctDays: days.length,
    bySentiment,
    sentimentMix: {
      POSITIVE: mix(bySentiment.POSITIVE),
      NEGATIVE: mix(bySentiment.NEGATIVE),
      NEUTRAL: mix(bySentiment.NEUTRAL),
    },
    currentStreak: current,
    longestStreak: longest,
    firstDay: days.length > 0 ? days[0] : null,
    lastDay: days.length > 0 ? days[days.length - 1] : null,
  };
}

function streaks(daysAsc: number[]): { current: number; longest: number } {
  if (daysAsc.length === 0) return { current: 0, longest: 0 };
  let longest = 1;
  let run = 1;
  for (let i = 1; i < daysAsc.length; i++) {
    run = daysAsc[i] === daysAsc[i - 1] + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  let current = 1;
  for (let i = daysAsc.length - 1; i > 0; i--) {
    if (daysAsc[i] === daysAsc[i - 1] + 1) current += 1;
    else break;
  }
  return { current, longest };
}
