import { schnorr } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { getRawTransaction, type RpcClient } from "@tachibtc/taurus-wallet-aggregator";

/**
 * Closes the gap flagged honestly in BondedRegistry's original comment: a
 * "bonded" amount that's just a number a service claims over POST isn't a
 * real Attack IV mitigation — nothing stops a Sybil from claiming a huge
 * fake number and outranking every real listing (a latent hole in the
 * original ranking-by-claimed-number design). This makes the bond real:
 * a registrant proves it controls a specific vault's owner key (a signed
 * challenge, closing "quoting a stranger's public vault info as your own"),
 * and the registry independently re-derives the bonded amount from the real
 * Bitcoin L1 output, not from anything the registrant asserts.
 *
 * Two independent checks, both against live state, neither trusted from the
 * caller:
 *   1. Tachi's own ledger (`listVaults`) confirms a vault matching the
 *      claimed address/funding outpoint is actually registered to the
 *      claimed owner key.
 *   2. The real Bitcoin L1 transaction (`getRawTransaction`, standard
 *      Bitcoin Core RPC — not Tachi-specific) is decoded directly to read
 *      the real value paid to the vault's address. This step exists because
 *      @tachibtc/taurus-vault-core's own VaultSummary.address doc comment
 *      says the daemon's recorded address is "NOT proof of where the funds
 *      sit" — nothing on the daemon cross-checks it against the L1
 *      scriptPubKey, so this module does that check itself.
 */

export interface BondClaim {
  serviceId: string;
  vaultAddress: string;
  /** Display/explorer-order hex txid (NOT the daemon's internal byte order). */
  fundingTxid: string;
  fundingVout: number;
}

const DOMAIN = "nibi-bond-proof-v1";

/**
 * The exact message both the signer and the verifier hash and sign/check —
 * defined once so client and server can never silently drift apart on the
 * message shape.
 */
export function bondChallengeMessageHash(nonce: string, claim: BondClaim): Uint8Array {
  const payload = `${DOMAIN}|${nonce}|${claim.serviceId}|${claim.vaultAddress}|${claim.fundingTxid}|${claim.fundingVout}`;
  return sha256(new TextEncoder().encode(payload));
}

/** Pure BIP340 Schnorr verification — no network access, no trust in the caller. */
export function verifyBondSignature(
  signatureHex: string,
  nonce: string,
  claim: BondClaim,
  ownerXOnlyHex: string
): boolean {
  try {
    const sig = Uint8Array.from(Buffer.from(signatureHex, "hex"));
    const pub = Uint8Array.from(Buffer.from(ownerXOnlyHex, "hex"));
    const msg = bondChallengeMessageHash(nonce, claim);
    return schnorr.verify(sig, msg, pub);
  } catch {
    return false;
  }
}

export interface RealBondCheckResult {
  ok: boolean;
  realBondedSats?: number;
  error?: string;
}

/** Raw shape of GET /tachi_listVaults, snake_case as the daemon actually returns it. */
interface RawListVaultsResponse {
  vaults: Array<{ address: string; funding_txid: string; funding_vout: number }>;
}

export async function verifyRealBondOnChain(input: {
  rpc: RpcClient;
  daemonUrl: string;
  ownerXOnlyHex: string;
  claim: BondClaim;
}): Promise<RealBondCheckResult> {
  const { rpc, daemonUrl, ownerXOnlyHex, claim } = input;

  // @tachibtc/taurus-vault-core's listVaults() wrapper enforces a 33-byte
  // compressed-pubkey format for `user` that the REAL daemon does not:
  // confirmed by hand that GET /tachi_listVaults?user=<x-only hex> (32
  // bytes — what a TxVaultOpen's owner field actually is) works correctly
  // against the live daemon. Calling the REST endpoint directly rather
  // than through the wrapper's stricter, incorrect client-side check.
  let listResult: RawListVaultsResponse;
  try {
    const res = await fetch(`${daemonUrl}/tachi_listVaults?user=${ownerXOnlyHex}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    listResult = (await res.json()) as RawListVaultsResponse;
  } catch (err) {
    return { ok: false, error: `Could not query Tachi's vault ledger: ${(err as Error).message}` };
  }
  const registered = listResult.vaults.find(
    (v) =>
      v.address === claim.vaultAddress &&
      Buffer.from(v.funding_txid, "hex").reverse().toString("hex") === claim.fundingTxid &&
      v.funding_vout === claim.fundingVout
  );
  if (!registered) {
    return { ok: false, error: "No vault registered to this owner matches the claimed address/funding outpoint." };
  }

  let rawTx;
  try {
    rawTx = await getRawTransaction(rpc, claim.fundingTxid);
  } catch (err) {
    return { ok: false, error: `Could not fetch the real L1 funding transaction: ${(err as Error).message}` };
  }
  const vout = rawTx.vout.find((v) => v.n === claim.fundingVout);
  if (!vout) {
    return { ok: false, error: "Claimed funding output does not exist on the real L1 transaction." };
  }
  if (vout.scriptPubKey.address !== claim.vaultAddress) {
    return { ok: false, error: "The real L1 output does not pay the claimed vault address." };
  }
  if (!rawTx.confirmations || rawTx.confirmations < 1) {
    return { ok: false, error: "Funding transaction is not yet confirmed on L1." };
  }

  return { ok: true, realBondedSats: Math.round(vout.value * 100_000_000) };
}
