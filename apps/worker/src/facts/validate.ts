import { MAX_PLAUSIBLE_PRICE, MIN_PLAUSIBLE_PRICE } from "@dip/domain";

/**
 * Pure validation for fact candidates — weak noise never reaches the fact
 * layer. Every rejection carries a reason for the audit log.
 */

export interface PriceCandidate {
  value: number;
  currency: string | null;
  observedAt: Date;
}

export interface RatingCandidate {
  value: number;
  reviewCount: number | null;
  observedAt: Date;
}

export type Validation<T> = { ok: true; value: T } | { ok: false; reason: string };

const FUTURE_SLACK_MS = 5 * 60 * 1000;

export function validatePriceCandidate(
  candidate: PriceCandidate,
): Validation<{ value: number; currency: string }> {
  if (!Number.isFinite(candidate.value)) {
    return { ok: false, reason: "price is not a finite number" };
  }
  if (candidate.value < MIN_PLAUSIBLE_PRICE || candidate.value >= MAX_PLAUSIBLE_PRICE) {
    return { ok: false, reason: `implausible price value ${candidate.value}` };
  }
  // Approved rule: currency is normalized to uppercase before insert, always.
  const currency = candidate.currency?.trim().toUpperCase() ?? "";
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, reason: `invalid currency '${candidate.currency ?? ""}'` };
  }
  const timeCheck = validateObservedAt(candidate.observedAt);
  if (!timeCheck.ok) return timeCheck;
  return { ok: true, value: { value: candidate.value, currency } };
}

export function validateRatingCandidate(
  candidate: RatingCandidate,
): Validation<{ value: number; reviewCount: number | null }> {
  if (!Number.isFinite(candidate.value) || candidate.value < 0 || candidate.value > 5) {
    return { ok: false, reason: `rating ${candidate.value} outside the 0-5 scale` };
  }
  if (candidate.reviewCount !== null) {
    if (!Number.isInteger(candidate.reviewCount) || candidate.reviewCount < 0) {
      return { ok: false, reason: `invalid review count ${candidate.reviewCount}` };
    }
  }
  const timeCheck = validateObservedAt(candidate.observedAt);
  if (!timeCheck.ok) return timeCheck;
  return { ok: true, value: { value: candidate.value, reviewCount: candidate.reviewCount } };
}

function validateObservedAt(observedAt: Date): Validation<never> | { ok: true; value: never } {
  if (Number.isNaN(observedAt.getTime())) {
    return { ok: false, reason: "observed_at is not a valid timestamp" };
  }
  if (observedAt.getTime() > Date.now() + FUTURE_SLACK_MS) {
    return { ok: false, reason: "observed_at is in the future" };
  }
  return { ok: true, value: undefined as never };
}

/**
 * retail_pulse_prices grain: the Sunday closing the observation's week (UTC).
 * A Sunday observation belongs to its own week_ending.
 */
export function weekEnding(observedAt: Date): string {
  const date = new Date(
    Date.UTC(observedAt.getUTCFullYear(), observedAt.getUTCMonth(), observedAt.getUTCDate()),
  );
  const daysUntilSunday = (7 - date.getUTCDay()) % 7;
  date.setUTCDate(date.getUTCDate() + daysUntilSunday);
  return date.toISOString().slice(0, 10);
}

/** voice_pulse_reviews grain: first day of the observation's month (UTC). */
export function periodMonth(observedAt: Date): string {
  return `${observedAt.getUTCFullYear()}-${String(observedAt.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
