import React from "react";
import type { Route } from "./router";

export interface NavProps {
  route: Route;
  onNavigate: (route: Route) => void;
}

interface NavItem {
  route: Exclude<Route, "compose">;
  label: string;
  ariaLabel: string;
  icon: React.ReactNode;
}

const ShelfIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
    <rect x="4" y="3.5" width="16" height="17" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M4 11h16M4 15.5h16M11.5 3.5v17" fill="none" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);

const StatsIcon = (
  <span className="nav-glyph" aria-hidden="true">
    #
  </span>
);

const HandIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
    <path
      d="M9 11.5V5.2a1.4 1.4 0 0 1 2.8 0v5m0-.4V3.9a1.4 1.4 0 0 1 2.8 0v6.4m0-.6V5.6a1.4 1.4 0 0 1 2.8 0V14a6.5 6.5 0 0 1-6.5 6.5A6.5 6.5 0 0 1 4.4 14v-2.6a1.4 1.4 0 0 1 2.8 0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// Exactly three primary destinations (OBS-798). Compose is the default landing
// view and is returned to via the brand/title, so it is intentionally not here.
const ITEMS: NavItem[] = [
  { route: "shelf", label: "Shelf", ariaLabel: "Shelf — re-read old entries", icon: ShelfIcon },
  { route: "stats", label: "Numbers", ariaLabel: "Numbers — entry counts, streaks, sentiment", icon: StatsIcon },
  { route: "hand", label: "Partner", ariaLabel: "Partner & services help", icon: HandIcon },
];

export function Nav({ route, onNavigate }: NavProps): React.ReactElement {
  return (
    <nav className="nav" aria-label="Primary">
      {ITEMS.map((item) => {
        const active = route === item.route;
        return (
          <button
            key={item.route}
            type="button"
            className={"nav-item" + (active ? " nav-item-active" : "")}
            aria-label={item.ariaLabel}
            aria-current={active ? "page" : undefined}
            onClick={() => onNavigate(item.route)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
