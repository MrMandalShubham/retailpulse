import { cleanText } from "./text.js";

export interface ParsedPrice {
  value: number;
  currency: string | null;
  raw: string;
}

/** ISO 4217 codes we accept verbatim when present in the text. */
const CURRENCY_CODE_PATTERN = /\b(USD|KRW|EUR|GBP|JPY|CNY|INR|SGD|AUD|CAD|HKD|TWD|THB|VND)\b/i;

const NUMBER_PATTERN = /\d{1,3}(?:[,.\s]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/;

/**
 * Parse a raw price string ("₩12,900", "US$ 24.00", "24,90 €") into a numeric
 * value plus detected currency. `symbolMap` comes from currency_hint rules
 * (symbol -> ISO code); longer symbols are checked first so "US$" wins over "$".
 * Returns null when no plausible number is present.
 */
export function parsePriceText(
  rawInput: string | null | undefined,
  symbolMap: ReadonlyMap<string, string>,
): ParsedPrice | null {
  const raw = cleanText(rawInput);
  if (!raw) return null;

  let currency: string | null = null;
  const codeMatch = raw.match(CURRENCY_CODE_PATTERN);
  if (codeMatch?.[0]) currency = codeMatch[0].toUpperCase();
  if (!currency) {
    const symbols = [...symbolMap.keys()].sort((a, b) => b.length - a.length);
    for (const symbol of symbols) {
      if (raw.includes(symbol)) {
        currency = symbolMap.get(symbol) ?? null;
        break;
      }
    }
  }

  const numberMatch = raw.match(NUMBER_PATTERN);
  if (!numberMatch?.[0]) return null;
  const value = parseNumber(numberMatch[0]);
  if (value === null || value <= 0 || value >= 100_000_000) return null;

  return { value, currency, raw };
}

/** Handle "1,234.56", "1.234,56", "12 900", and plain numbers. */
function parseNumber(text: string): number | null {
  let normalized = text.replace(/\s/g, "");
  const lastComma = normalized.lastIndexOf(",");
  const lastDot = normalized.lastIndexOf(".");

  if (lastComma > -1 && lastDot > -1) {
    // Rightmost separator is the decimal mark; the other is thousands.
    if (lastComma > lastDot) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (lastComma > -1) {
    const digitsAfter = normalized.length - lastComma - 1;
    // ",90" -> decimal; ",900" -> thousands separator.
    normalized = digitsAfter === 3 ? normalized.replace(/,/g, "") : normalized.replace(",", ".");
  } else if (lastDot > -1) {
    const digitsAfter = normalized.length - lastDot - 1;
    normalized = digitsAfter === 3 ? normalized.replace(/\./g, "") : normalized;
  }

  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}
