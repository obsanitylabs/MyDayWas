import { describe, expect, it } from "vitest";
import { computeStats } from "../src/ui/stats";
import type { DecryptedEntry, Sentiment } from "../src/app/api";

function entry(day: number, sentiment: Sentiment, id?: string): DecryptedEntry {
  return { id: id ?? `${day}-${sentiment}-${Math.random().toString(36).slice(2)}`, day, text: "x", sentiment, createdAtMs: day * 86_400_000 };
}

describe("computeStats (local, from stored entries)", () => {
  it("is empty-safe", () => {
    const s = computeStats([]);
    expect(s.total).toBe(0);
    expect(s.distinctDays).toBe(0);
    expect(s.bySentiment).toEqual({ POSITIVE: 0, NEGATIVE: 0, NEUTRAL: 0 });
    expect(s.sentimentMix).toEqual({ POSITIVE: 0, NEGATIVE: 0, NEUTRAL: 0 });
    expect(s.currentStreak).toBe(0);
    expect(s.longestStreak).toBe(0);
    expect(s.firstDay).toBeNull();
    expect(s.lastDay).toBeNull();
  });

  it("counts entries and sentiment, and computes the mix", () => {
    const s = computeStats([entry(1, "POSITIVE"), entry(1, "NEGATIVE"), entry(1, "NEUTRAL"), entry(2, "POSITIVE")]);
    expect(s.total).toBe(4);
    expect(s.bySentiment).toEqual({ POSITIVE: 2, NEGATIVE: 1, NEUTRAL: 1 });
    expect(s.sentimentMix).toEqual({ POSITIVE: 50, NEGATIVE: 25, NEUTRAL: 25 });
  });

  it("counts distinct days, not entries", () => {
    const s = computeStats([entry(5, "NEUTRAL"), entry(5, "NEUTRAL"), entry(5, "POSITIVE")]);
    expect(s.total).toBe(3);
    expect(s.distinctDays).toBe(1);
    expect(s.firstDay).toBe(5);
    expect(s.lastDay).toBe(5);
  });

  it("computes the longest and current (latest-anchored) streaks", () => {
    const s = computeStats([entry(10, "NEUTRAL"), entry(11, "NEUTRAL"), entry(12, "NEUTRAL"), entry(15, "NEUTRAL"), entry(16, "NEUTRAL")]);
    expect(s.longestStreak).toBe(3);
    expect(s.currentStreak).toBe(2);
    expect(s.firstDay).toBe(10);
    expect(s.lastDay).toBe(16);
  });

  it("does not let several entries on one day inflate a streak", () => {
    const s = computeStats([entry(1, "NEUTRAL"), entry(1, "NEUTRAL"), entry(2, "NEUTRAL")]);
    expect(s.currentStreak).toBe(2);
    expect(s.longestStreak).toBe(2);
  });

  it("ignores input order", () => {
    const s = computeStats([entry(16, "NEUTRAL"), entry(10, "NEUTRAL"), entry(11, "NEUTRAL")]);
    expect(s.firstDay).toBe(10);
    expect(s.lastDay).toBe(16);
  });
});
