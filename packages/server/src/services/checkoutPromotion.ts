import type Stripe from "stripe";

/** Only minted from the Stripe response after matching the server-side checkout. */
export type CheckoutPromotionId = string & {
  readonly __checkoutPromotionId: unique symbol;
};
export class CheckoutPromotionUnavailableError extends Error {
  readonly code = "promotion_code_unavailable";
  constructor() {
    super("Promotion code is unavailable");
    this.name = "CheckoutPromotionUnavailableError";
  }
}
export function normalizeCheckoutPromotionCode(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new CheckoutPromotionUnavailableError();
  const code = value.trim();
  if (code === "") return null;
  if (code.length > 128 || /[\u0000-\u001f\u007f-\u009f]/u.test(code))
    throw new CheckoutPromotionUnavailableError();
  return code;
}
function objectId(value: string | { id: string }): string {
  return typeof value === "string" ? value : value.id;
}

/** Stripe owns eligibility; these checks prevent selecting another customer, mode or product. */
export async function resolveCheckoutPromotion(
  stripe: Stripe,
  code: string,
  input: {
    customerId: string | null;
    priceId: string;
    interval: "month" | "year";
    secretKey: string;
  },
): Promise<CheckoutPromotionId> {
  try {
    const live = /^(sk|rk)_live_/.test(input.secretKey);
    if (!live && !/^(sk|rk)_test_/.test(input.secretKey))
      throw new CheckoutPromotionUnavailableError();
    const price = await stripe.prices.retrieve(
      input.priceId,
      {},
      { timeout: 10_000, maxNetworkRetries: 0 },
    );
    if (
      !price.active ||
      price.livemode !== live ||
      price.type !== "recurring" ||
      price.recurring?.interval !== input.interval ||
      price.recurring.interval_count !== 1
    )
      throw new CheckoutPromotionUnavailableError();
    const productId = objectId(price.product);
    const matches: Stripe.PromotionCode[] = [];
    let cursor: string | undefined;
    // Customer-specific codes may share text. Exhaust bounded pages before deciding uniqueness.
    for (let page = 0; page < 10; page++) {
      const result = await stripe.promotionCodes.list(
        {
          code,
          active: true,
          limit: 100,
          expand: ["data.promotion.coupon.currency_options"],
          ...(cursor ? { starting_after: cursor } : {}),
        },
        { timeout: 10_000, maxNetworkRetries: 0 },
      );
      for (const candidate of result.data) {
        if (
          candidate.code.toLowerCase() !== code.toLowerCase() ||
          !candidate.active ||
          candidate.livemode !== live ||
          candidate.customer_account
        )
          continue;
        if (
          candidate.customer &&
          objectId(candidate.customer) !== input.customerId
        )
          continue;
        matches.push(candidate);
      }
      if (matches.length > 1) throw new CheckoutPromotionUnavailableError();
      if (!result.has_more) break;
      const next = result.data.at(-1)?.id;
      if (!next || next === cursor || page === 9)
        throw new CheckoutPromotionUnavailableError();
      cursor = next;
    }
    if (matches.length !== 1) throw new CheckoutPromotionUnavailableError();
    const promotion = matches[0];
    const coupon =
      promotion.promotion.type === "coupon" ? promotion.promotion.coupon : null;
    const now = Math.floor(Date.now() / 1000);
    if (
      !/^promo_[A-Za-z0-9]+$/.test(promotion.id) ||
      !coupon ||
      typeof coupon === "string" ||
      "deleted" in coupon ||
      !coupon.valid ||
      coupon.livemode !== live ||
      (promotion.expires_at != null && promotion.expires_at <= now) ||
      (promotion.max_redemptions != null &&
        promotion.times_redeemed >= promotion.max_redemptions) ||
      (coupon.redeem_by != null && coupon.redeem_by <= now) ||
      (coupon.max_redemptions != null &&
        coupon.times_redeemed >= coupon.max_redemptions) ||
      (coupon.applies_to?.products.length &&
        !coupon.applies_to.products.includes(productId)) ||
      (coupon.amount_off != null &&
        coupon.currency !== price.currency &&
        !coupon.currency_options?.[price.currency])
    ) {
      throw new CheckoutPromotionUnavailableError();
    }
    // Minimum amount / first purchase / currency and races are finally enforced by Stripe Checkout.
    return promotion.id as CheckoutPromotionId;
  } catch {
    // Never persist or echo provider errors: they may contain the raw code or provider request data.
    throw new CheckoutPromotionUnavailableError();
  }
}
