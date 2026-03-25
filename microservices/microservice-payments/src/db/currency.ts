/**
 * Multi-currency conversion utilities
 */

// --- Multi-Currency Conversion ---

const CURRENCY_RATES: Record<string, Record<string, number>> = {
  USD: { EUR: 0.92, GBP: 0.79, CAD: 1.36, AUD: 1.53, USD: 1.0 },
  EUR: { USD: 1.09, GBP: 0.86, CAD: 1.48, AUD: 1.66, EUR: 1.0 },
  GBP: { USD: 1.27, EUR: 1.16, CAD: 1.72, AUD: 1.93, GBP: 1.0 },
  CAD: { USD: 0.74, EUR: 0.68, GBP: 0.58, AUD: 1.13, CAD: 1.0 },
  AUD: { USD: 0.65, EUR: 0.60, GBP: 0.52, CAD: 0.89, AUD: 1.0 },
};

export interface CurrencyConversion {
  original_amount: number;
  converted_amount: number;
  from: string;
  to: string;
  rate: number;
}

export function convertCurrency(amount: number, from: string, to: string): CurrencyConversion | null {
  const fromUpper = from.toUpperCase();
  const toUpper = to.toUpperCase();

  const fromRates = CURRENCY_RATES[fromUpper];
  if (!fromRates) return null;

  const rate = fromRates[toUpper];
  if (rate === undefined) return null;

  return {
    original_amount: amount,
    converted_amount: Math.round(amount * rate * 100) / 100,
    from: fromUpper,
    to: toUpper,
    rate,
  };
}
