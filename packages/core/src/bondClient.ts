import { Keystore, getNetwork } from "@tachibtc/taurus-wallet-aggregator";
import { toXOnly, type TaprootSigner } from "@tachibtc/taurus-vault-core";
import { bondChallengeMessageHash, type BondClaim } from "./bondProof.js";

/**
 * A real, already-registered Tachi vault a demo service uses to prove its
 * own registry bond. Deliberately fixed/reused rather than generated fresh
 * per process start — registering a brand new vault takes a real ~15-20min
 * faucet-confirmation cycle (see scripts/real-sdk-register-vault-test.ts),
 * which is a bad restart experience for a dev server. These are real,
 * regtest-only, throwaway fixtures with no real value — safe to keep in
 * source, same as every other real-SDK mnemonic printed in this project.
 */
export interface RealVaultFixture {
  mnemonic: string;
  vaultAddress: string;
  fundingTxid: string;
  fundingVout: number;
}

export function signerFromMnemonic(mnemonic: string): { signer: TaprootSigner; ownerXOnlyHex: string } {
  const keystore = Keystore.fromMnemonic(mnemonic, "", getNetwork("regtest"), "p2wpkh", 0);
  const node = keystore.signerFor(false, 0);
  const signer: TaprootSigner = {
    publicKey: Buffer.from(node.publicKey),
    sign: (h) => Buffer.from(node.sign(h)),
    signSchnorr: (h) => Buffer.from(node.signSchnorr!(h)),
  };
  return { signer, ownerXOnlyHex: toXOnly(signer.publicKey).toString("hex") };
}

/**
 * Completes the full challenge -> sign -> verify round trip against a
 * running Nibi registry (apps/demo-api). Used by apps/agent-b and
 * apps/demo-api itself on startup to register a REAL, cryptographically
 * proven bond instead of the old self-reported POST.
 */
export async function registerVerifiedBond(input: {
  registryUrl: string;
  serviceId: string;
  fixture: RealVaultFixture;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { registryUrl, serviceId, fixture } = input;
  const fetchFn = input.fetchImpl ?? fetch;
  const { signer, ownerXOnlyHex } = signerFromMnemonic(fixture.mnemonic);

  const challengeRes = await fetchFn(`${registryUrl}/registry/bond-challenge?owner=${ownerXOnlyHex}`);
  if (!challengeRes.ok) {
    return { ok: false, error: `challenge request failed: HTTP ${challengeRes.status}` };
  }
  const { nonce } = (await challengeRes.json()) as { nonce: string };

  const claim: BondClaim = {
    serviceId,
    vaultAddress: fixture.vaultAddress,
    fundingTxid: fixture.fundingTxid,
    fundingVout: fixture.fundingVout,
  };
  const msgHash = bondChallengeMessageHash(nonce, claim);
  const sigBuf = await Promise.resolve(signer.signSchnorr!(Buffer.from(msgHash)));
  const signature = Buffer.from(sigBuf).toString("hex");

  const verifyRes = await fetchFn(`${registryUrl}/registry/services/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner: ownerXOnlyHex, nonce, signature, ...claim }),
  });
  if (!verifyRes.ok) {
    const body = await verifyRes.json().catch(() => ({}) as { error?: string });
    return { ok: false, error: (body as { error?: string }).error ?? `verify failed: HTTP ${verifyRes.status}` };
  }
  return { ok: true };
}
