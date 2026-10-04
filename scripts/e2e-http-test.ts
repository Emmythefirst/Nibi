import { NibiClient } from "@nibi/client";
import type { PaymentEvent } from "@nibi/client";
import { createMockTaurusAdapter } from "@nibi/core";

const API_URL = "http://localhost:4402/api/insight";

async function main() {
  const adapter = createMockTaurusAdapter();
  const client = new NibiClient(adapter, {
    maxSatsPerRequest: 100,
    maxSatsPerWindow: 1000,
    windowMs: 60_000,
    autoApproveUnderSats: 100,
  });

  let capturedHeader: string | null = null;

  console.log(`Paying ${API_URL} for real over HTTP...\n`);

  const res = await client.fetch(API_URL, {
    onPaymentEvent: (event: PaymentEvent) => {
      console.log("event:", event.type);
      if (event.type === "paid") capturedHeader = event.obolHeader;
    },
  });

  if (!res.ok) throw new Error(`FAIL: expected a 200 from the paid request, got ${res.status}`);
  const body = await res.json();
  console.log("\nPaid request succeeded:", body);

  if (!capturedHeader) throw new Error("FAIL: no X-OBOL header was captured");

  console.log("\nReplaying the captured payment header against the same endpoint...");
  const replay = await fetch(API_URL, { headers: { "X-OBOL": capturedHeader } });
  console.log("Replay response status:", replay.status);
  if (replay.status !== 409) {
    throw new Error(`FAIL: expected 409 on replay, got ${replay.status}`);
  }
  const replayBody = await replay.json();
  console.log("Replay correctly rejected:", replayBody.error);

  console.log("\nEnd-to-end HTTP test PASSED.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
