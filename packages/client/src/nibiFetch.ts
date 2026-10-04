import { toBase64 } from "@nibi/core/browser";
import type { PaymentChallenge, SpendingMandate, TaurusAdapter } from "@nibi/core/browser";
import { payChallenge } from "./obol.js";
import { MandateEnforcer } from "./mandate.js";

export type PaymentEvent =
  | { type: "challenge"; challenge: PaymentChallenge }
  | { type: "blocked"; reason: string }
  | { type: "awaiting-confirmation"; challenge: PaymentChallenge }
  | { type: "paid"; challenge: PaymentChallenge; receiptId: string; obolHeader: string }
  | { type: "denied"; challenge: PaymentChallenge };

export interface NibiFetchOptions extends RequestInit {
  onPaymentEvent?: (event: PaymentEvent) => void;
  /**
   * Called when a payment exceeds the mandate's auto-approve threshold.
   * Return true to proceed, false to deny. If omitted, anything requiring
   * confirmation is denied by default — Nibi never assumes "yes".
   */
  confirmAboveThreshold?: (challenge: PaymentChallenge) => Promise<boolean>;
}

/**
 * The agent-facing SDK. Drop-in replacement for fetch that transparently
 * handles the 402 challenge -> pay -> retry cycle, gated by a signed
 * Spending Mandate that's checked BEFORE any payment is constructed.
 */
export class NibiClient {
  private mandateEnforcer: MandateEnforcer;

  constructor(
    private adapter: TaurusAdapter,
    mandate: SpendingMandate
  ) {
    this.mandateEnforcer = new MandateEnforcer(mandate);
  }

  async fetch(url: string, opts: NibiFetchOptions = {}): Promise<Response> {
    const first = await fetch(url, opts);
    if (first.status !== 402) {
      return first;
    }

    const challenge = (await first.json()) as PaymentChallenge;
    opts.onPaymentEvent?.({ type: "challenge", challenge });

    const check = this.mandateEnforcer.check(challenge.resourcePath, challenge.priceSats);
    if (!check.allowed) {
      opts.onPaymentEvent?.({ type: "blocked", reason: check.reason ?? "blocked by spending mandate" });
      throw new Error(`Nibi: payment blocked by spending mandate — ${check.reason}`);
    }

    if (check.requiresConfirmation) {
      opts.onPaymentEvent?.({ type: "awaiting-confirmation", challenge });
      const approved = opts.confirmAboveThreshold ? await opts.confirmAboveThreshold(challenge) : false;
      if (!approved) {
        opts.onPaymentEvent?.({ type: "denied", challenge });
        throw new Error("Nibi: payment required human confirmation and was not approved");
      }
    }

    const receipt = await payChallenge(challenge, this.adapter);
    this.mandateEnforcer.record(challenge.priceSats);
    const obolHeader = toBase64(receipt);
    opts.onPaymentEvent?.({ type: "paid", challenge, receiptId: receipt.paymentId, obolHeader });

    const headers = new Headers(opts.headers);
    headers.set("X-OBOL", obolHeader);
    return fetch(url, { ...opts, headers });
  }

  getSpendLog() {
    return this.mandateEnforcer.getSpendLog();
  }
}
