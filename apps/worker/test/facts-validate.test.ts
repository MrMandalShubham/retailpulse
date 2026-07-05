import { describe, expect, it } from "vitest";
import {
  periodMonth,
  validatePriceCandidate,
  validateRatingCandidate,
  weekEnding,
} from "../src/facts/validate.js";

const NOW = new Date("2026-07-05T10:00:00Z");

describe("validatePriceCandidate", () => {
  it("accepts plausible prices and uppercases currency (approved rule)", () => {
    const result = validatePriceCandidate({ value: 21.99, currency: "usd", observedAt: NOW });
    expect(result).toEqual({ ok: true, value: { value: 21.99, currency: "USD" } });
  });

  it("rejects implausible values, bad currencies, and future observations", () => {
    expect(validatePriceCandidate({ value: 0, currency: "USD", observedAt: NOW }).ok).toBe(false);
    expect(
      validatePriceCandidate({ value: 250_000_000, currency: "USD", observedAt: NOW }).ok,
    ).toBe(false);
    expect(validatePriceCandidate({ value: 10, currency: "US", observedAt: NOW }).ok).toBe(false);
    expect(validatePriceCandidate({ value: 10, currency: null, observedAt: NOW }).ok).toBe(false);
    const future = new Date(Date.now() + 3_600_000);
    const rejected = validatePriceCandidate({ value: 10, currency: "USD", observedAt: future });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.reason).toContain("future");
  });
});

describe("validateRatingCandidate", () => {
  it("accepts 0-5 ratings with optional review counts", () => {
    expect(validateRatingCandidate({ value: 4.6, reviewCount: 2841, observedAt: NOW })).toEqual({
      ok: true,
      value: { value: 4.6, reviewCount: 2841 },
    });
    expect(validateRatingCandidate({ value: 0, reviewCount: null, observedAt: NOW }).ok).toBe(true);
  });

  it("rejects out-of-scale ratings and negative counts", () => {
    expect(validateRatingCandidate({ value: 5.5, reviewCount: null, observedAt: NOW }).ok).toBe(
      false,
    );
    expect(validateRatingCandidate({ value: -1, reviewCount: null, observedAt: NOW }).ok).toBe(
      false,
    );
    expect(validateRatingCandidate({ value: 4, reviewCount: -3, observedAt: NOW }).ok).toBe(false);
    expect(validateRatingCandidate({ value: 4, reviewCount: 1.5, observedAt: NOW }).ok).toBe(false);
  });
});

describe("period helpers", () => {
  it("weekEnding returns the Sunday closing the observation's week (UTC)", () => {
    expect(weekEnding(new Date("2026-07-04T05:11:41Z"))).toBe("2026-07-05"); // Saturday -> Sunday
    expect(weekEnding(new Date("2026-07-05T23:59:00Z"))).toBe("2026-07-05"); // Sunday stays
    expect(weekEnding(new Date("2026-07-06T00:00:00Z"))).toBe("2026-07-12"); // Monday -> next Sunday
  });

  it("periodMonth returns the first of the observation's month (UTC)", () => {
    expect(periodMonth(new Date("2026-07-31T23:00:00Z"))).toBe("2026-07-01");
    expect(periodMonth(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01");
  });
});
