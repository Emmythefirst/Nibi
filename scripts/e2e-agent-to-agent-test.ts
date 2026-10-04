import { NibiClient } from "@nibi/client";
import type { PaymentEvent } from "@nibi/client";
import { createMockTaurusAdapter } from "@nibi/core";

// Requires apps/agent-b running on :4403 (npm run dev:agent-b).
const AGENT_B_URL = "http://localhost:4403/api/fact-check";

async function main() {
  const adapter = createMockTaurusAdapter();
  const client = new NibiClient(adapter, {
    maxSatsPerRequest: 100,
    maxSatsPerWindow: 1000,
    windowMs: 60_000,
    autoApproveUnderSats: 100,
  });

  console.log(`Paying Agent B at ${AGENT_B_URL} for real over HTTP...\n`);

  const res = await client.fetch(AGENT_B_URL, {
    onPaymentEvent: (event: PaymentEvent) => console.log("event:", event.type),
  });

  if (!res.ok) throw new Error(`FAIL: expected 200 from the agent-to-agent payment, got ${res.status}`);
  const body = await res.json();
  console.log("\nAgent B responded:", body);

  if (body.verifiedBy !== "agent-b") {
    throw new Error(`FAIL: expected response to come from agent-b, got ${JSON.stringify(body)}`);
  }

  console.log("\nAgent-to-agent payment PASSED — same SDK, same protocol, a different party on the other end.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
