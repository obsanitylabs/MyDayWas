/**
 * OBS-789 warm writing space: tiny hash router.
 *
 * The app is served from the apex site at `/app/`, so hash routing keeps the
 * whole navigation client-side with no server rewrites. The compose (write)
 * view is the default: any unknown or empty hash resolves to "compose".
 */
export type Route = "compose" | "shelf" | "stats" | "hand";

export const ROUTES: readonly Route[] = ["compose", "shelf", "stats", "hand"];

export function parseRoute(hash: string | null | undefined): Route {
  const cleaned = String(hash ?? "")
    .replace(/^#\/?/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  switch (cleaned) {
    case "shelf":
      return "shelf";
    case "stats":
      return "stats";
    case "hand":
      return "hand";
    default:
      return "compose";
  }
}

export function routeToHash(route: Route): string {
  return route === "compose" ? "" : `#${route}`;
}
