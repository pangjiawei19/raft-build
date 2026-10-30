import type { IntlShape } from "react-intl";

const CURRENCY = { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

/**
 * Dollars with cents. Provider spend is often a fraction of a cent: a positive
 * amount under $0.01 reads "under $0.01", never "$0.00".
 */
export function formatUsdAmount(intl: Pick<IntlShape, "formatMessage" | "formatNumber">, usd: number): string {
  return usd > 0 && usd < 0.01
    ? intl.formatMessage({ id: "common.usdBelowMinimum" }, { amount: intl.formatNumber(0.01, CURRENCY) })
    : intl.formatNumber(usd, CURRENCY);
}
