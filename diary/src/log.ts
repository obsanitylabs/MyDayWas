/**
 * Logging hygiene (M3 acceptance / R9-homogeneous policy).
 *
 * log() accepts ONLY static category + message strings plus an optional
 * numeric count. Never pass diary plaintext, entry ids, wallet addresses,
 * or precise timestamps into it. A plain console path is used so no log
 * ingestion or remote transport ever exists in v1.
 */

export function log(category: "app" | "crypto" | "sync" | "export", message: string, count?: number): void {
  const line = count === undefined ? `[mydaywas:${category}] ${message}` : `[mydaywas:${category}] ${message} (${count})`;
  console.info(line);
}