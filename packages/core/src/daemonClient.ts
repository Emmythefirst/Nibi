import { TachiClient } from "@tachibtc/tachi-sdk-ts";

/**
 * Real connection to Tachi's DAEMON RPC — no mock involved. This is the one
 * slice of "real Tachi SDK" that's fully usable today with zero blockers:
 * public npm package, no API key, live public regtest endpoint.
 *
 * What it is NOT: a way to move sats. Settlement (cooperative VTXO
 * transfer + broadcast) needs a funded vault and a quorum cosignature,
 * neither of which is obtainable through public, unauthenticated access —
 * see the long comment in taurusAdapter.ts for exactly what's blocked and
 * why. This client is for reads: proving the network is live, and reading
 * real chain state once a funded vault exists.
 */
const DEFAULT_DAEMON_URL = "https://rpc-regtest.tachibtc.com";

/**
 * `@nibi/core` is shared between Node (servers, scripts) and the browser
 * (apps/demo-agent, via Vite) — `process` only exists in the former, and
 * Vite doesn't polyfill it, so this guards against a ReferenceError that
 * would otherwise crash the dashboard on mount.
 */
function getDaemonUrlOverride(): string | undefined {
  return typeof process !== "undefined" ? process.env?.TACHI_DAEMON_URL : undefined;
}

export function createDaemonClient(baseUrl?: string): TachiClient {
  return new TachiClient({
    baseUrl: baseUrl ?? getDaemonUrlOverride() ?? DEFAULT_DAEMON_URL,
  });
}

export interface DaemonHealth {
  reachable: boolean;
  status?: string;
  validators?: number;
  error?: string;
}

/**
 * Best-effort liveness probe against the real daemon. Never throws — a
 * demo running with no network access, or against a daemon that's down,
 * should degrade to "we couldn't confirm the network is live" rather than
 * crash the request path that's checking it.
 */
export async function probeDaemonHealth(client: TachiClient): Promise<DaemonHealth> {
  try {
    const health = await client.getHealth();
    return { reachable: true, status: health.status, validators: health.validators };
  } catch (err) {
    return { reachable: false, error: (err as Error).message };
  }
}
