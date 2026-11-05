import { useCallback, useEffect, useState } from "react";
import { parseRoute, routeToHash, type Route } from "./router";

export interface HashRoute {
  route: Route;
  navigate: (route: Route) => void;
}

/**
 * Subscribes to `window.location.hash`. Compose is the default landing view
 * (empty hash). Navigating clears the hash entirely for compose so a reload or
 * a back button lands on the write view rather than a stale `#compose`.
 */
export function useHashRoute(): HashRoute {
  const [route, setRoute] = useState<Route>(() => parseRoute(globalThis.location?.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseRoute(globalThis.location.hash));
    globalThis.addEventListener("hashchange", onChange);
    return () => globalThis.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((next: Route) => {
    setRoute(next);
    if (!globalThis.location) return;
    const target = routeToHash(next);
    if (target) {
      globalThis.location.hash = target;
    } else {
      globalThis.history.replaceState(null, "", globalThis.location.pathname + globalThis.location.search);
    }
  }, []);

  return { route, navigate };
}
