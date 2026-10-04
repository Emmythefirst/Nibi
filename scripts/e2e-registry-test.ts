// Requires apps/demo-api running on :4402 (npm run dev:api).
const REGISTRY_URL = "http://localhost:4402/registry/services";

interface BondedListing {
  serviceId: string;
  bondedSats: number;
  registeredAt: number;
}

async function main() {
  console.log("Checking the bonded service registry...\n");

  const before: BondedListing[] = await (await fetch(REGISTRY_URL)).json();
  console.log("Current listings:", before);

  const realListing = before.find((l) => l.serviceId.includes("nibi-insight-api"));
  if (!realListing || realListing.bondedSats <= 0) {
    throw new Error("FAIL: expected the seeded real listing with a positive bond to be present");
  }

  console.log("\nRegistering a Sybil listing with a 0-sat bond...");
  const fakeId = `sybil-test-${Math.random().toString(36).slice(2, 7)}`;
  const postRes = await fetch(REGISTRY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serviceId: fakeId, bondedSats: 0 }),
  });
  if (postRes.status !== 201) throw new Error(`FAIL: expected 201 from registration, got ${postRes.status}`);

  const after: BondedListing[] = await postRes.json();
  const fakeIndex = after.findIndex((l) => l.serviceId === fakeId);
  const realIndex = after.findIndex((l) => l.serviceId === realListing.serviceId);

  if (fakeIndex === -1) throw new Error("FAIL: Sybil listing did not register");
  if (fakeIndex <= realIndex) {
    throw new Error("FAIL: an unbonded Sybil listing ranked at or above a real bonded listing");
  }

  console.log(`\nSybil listing registered at rank ${fakeIndex + 1} of ${after.length} (bonded services rank above it).`);
  console.log("Registry test PASSED — listing is free, but rank is not.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
