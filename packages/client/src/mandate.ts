import type { SpendingMandate, MandateCheckResult } from "@nibi/core/browser";

interface SpendRecord {
  amountSats: number;
  at: number;
}

/**
 * Enforces a SpendingMandate client-side, before any payment is ever
 * constructed. This is the leash: an agent using NibiClient cannot spend
 * above its per-request cap or its rolling-window cap no matter what the
 * server asks for, and anything above the auto-approve threshold blocks on
 * human confirmation. Same underlying judgment as Clavis's Guardian
 * boundary — autonomy without a limit reads as reckless, not impressive —
 * applied here to payments instead of vault exits.
 */
export class MandateEnforcer {
  private history: SpendRecord[] = [];

  constructor(private mandate: SpendingMandate) {}

  check(resourcePath: string, priceSats: number): MandateCheckResult {
    if (this.mandate.allowedResources && !this.mandate.allowedResources.includes(resourcePath)) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: `Resource "${resourcePath}" is not on the mandate's allowlist`,
      };
    }

    if (priceSats > this.mandate.maxSatsPerRequest) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: `${priceSats} sats exceeds the max-per-request limit of ${this.mandate.maxSatsPerRequest} sats`,
      };
    }

    const windowStart = Date.now() - this.mandate.windowMs;
    const spentInWindow = this.history
      .filter((record) => record.at >= windowStart)
      .reduce((sum, record) => sum + record.amountSats, 0);

    if (spentInWindow + priceSats > this.mandate.maxSatsPerWindow) {
      return {
        allowed: false,
        requiresConfirmation: true,
        reason: `Would exceed the spending window limit (${spentInWindow}/${this.mandate.maxSatsPerWindow} sats already spent this window)`,
      };
    }

    if (priceSats > this.mandate.autoApproveUnderSats) {
      return {
        allowed: true,
        requiresConfirmation: true,
        reason: `${priceSats} sats is above the ${this.mandate.autoApproveUnderSats}-sat auto-approve threshold`,
      };
    }

    return { allowed: true, requiresConfirmation: false };
  }

  record(amountSats: number) {
    this.history.push({ amountSats, at: Date.now() });
  }

  getSpendLog(): SpendRecord[] {
    return [...this.history];
  }
}
