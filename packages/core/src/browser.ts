/**
 * Browser-safe subset of @nibi/core. apps/demo-agent (a Vite/React app) must
 * import from here, NOT from the package root — the root index.ts re-exports
 * bondProof.ts/bondClient.ts, which pull in @tachibtc/taurus-vault-core and
 * @tachibtc/taurus-wallet-aggregator for real vault signing/RPC. Those are
 * genuinely Node-only (taurus-vault-core's compiled output imports Node's
 * `crypto` directly — confirmed by hand: `vite build` hard-fails resolving
 * it, even though `vite dev` doesn't visibly crash, since the dashboard
 * never actually calls that code path at runtime). Without this split, a
 * production build of the dashboard fails outright, and if "fixed" with a
 * browser crypto shim instead of this split, the real high-severity
 * axios/valibot/sats-connect vulnerabilities `npm audit` flagged (all
 * transitive through taurus-wallet-aggregator) would ship to every visitor's
 * browser for code the dashboard never uses. See PROGRESS.md.
 *
 * Only export what apps/demo-agent's src/lib/nibiSetup.ts actually needs:
 * the mock adapter (used for the live demo) and shared protocol types.
 * Anything needing real Tachi SDK signing/RPC belongs in the full index.ts,
 * consumed only by Node processes (apps/demo-api, apps/agent-b, scripts/*).
 */
export * from "./types.js";
export * from "./encoding.js";
export * from "./commitment.js";
export * from "./taurusAdapter.js";
export * from "./daemonClient.js";
export * from "./hatProof.js";
