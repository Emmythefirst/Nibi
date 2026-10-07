import { NibiClient } from "@nibi/client";
// @nibi/core/browser, not @nibi/core: the package root also exports
// bondProof.ts/bondClient.ts, which pull in Node-only Tachi SDK signing code
// that breaks a real production build of this browser app — see browser.ts.
import { createMockTaurusAdapter } from "@nibi/core/browser";
import type { SpendingMandate } from "@nibi/core/browser";

// Deliberately tight so the demo can actually show the mandate ceiling and
// the human-confirmation prompt within a handful of clicks.
export const DEMO_MANDATE: SpendingMandate = {
  maxSatsPerRequest: 100,
  maxSatsPerWindow: 120,
  windowMs: 60_000,
  autoApproveUnderSats: 50,
};

// Overridable via Vite build-time env vars so a deployed build (Vercel,
// etc.) can point at real hosted backends instead of localhost — see
// README "Deploying" section. Falls back to localhost for local dev.
const DEMO_API_BASE = import.meta.env.VITE_DEMO_API_URL ?? "http://localhost:4402";
const AGENT_B_BASE = import.meta.env.VITE_AGENT_B_URL ?? "http://localhost:4403";

export const DEMO_API_URL = `${DEMO_API_BASE}/api/insight`;
export const REGISTRY_URL = `${DEMO_API_BASE}/registry/services`;

// Priced between autoApproveUnderSats and maxSatsPerRequest above, so this
// is the one demo action that actually reaches the "awaiting confirmation"
// Approve/Deny UI — DEMO_API_URL (25 sats) and AGENT_B_URL (10 sats) are
// both under the auto-approve threshold and can only hit the hard window-cap
// block, never the softer confirm-threshold path.
export const PREMIUM_INSIGHT_URL = `${DEMO_API_BASE}/api/premium-insight`;

// Agent B is a second, independent process (apps/agent-b) — the
// counterparty for the agent-to-agent demo beat, as opposed to
// DEMO_API_URL which is a plain agent-to-service call.
export const AGENT_B_URL = `${AGENT_B_BASE}/api/fact-check`;

export function createDemoClient(): NibiClient {
  const adapter = createMockTaurusAdapter();
  return new NibiClient(adapter, DEMO_MANDATE);
}
