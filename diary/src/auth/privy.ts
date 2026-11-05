/**
 * OBS-789 / OBS-798 — Privy scaffold ONLY.
 *
 * This module exposes the Privy application config driven by the build-time
 * `VITE_PRIVY_APP_ID`. It returns `null` when the id is unset, which is the
 * shipping state today: the existing injected EIP-1193 wallet auth
 * (`src/auth/wallet.ts`) stays the active path.
 *
 * Deliberately NOT wired into the render tree yet — the Privy integration
 * (provider, login, and the seed-phrase / wallet-recovery export) is out of
 * scope until an App ID exists. Do not add `PrivyProvider` to `main.tsx` here.
 */
export interface PrivyConfig {
  appId: string;
}

export function getPrivyConfig(
  env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>,
): PrivyConfig | null {
  const appId = env.VITE_PRIVY_APP_ID;
  if (!appId) return null;
  return { appId };
}

export default getPrivyConfig;
