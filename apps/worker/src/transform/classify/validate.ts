import type { PageType, ValidationStatus } from "@dip/domain";

export interface ValidationInput {
  pageType: PageType;
  name: string | null;
  brandResolved: boolean;
  priceTextPresent: boolean;
  priceParsed: boolean;
  conflicts: string[];
  unresolvedFields: string[];
  confidenceScore: number;
}

export interface ValidationResult {
  status: ValidationStatus;
  errors: string[];
}

/**
 * Local validation lifecycle for a staged product candidate.
 *   invalid      — cannot be a product record (missing name, wrong page kind)
 *   needs_review — plausible product but with gaps/conflicts a human or
 *                  future AI should look at
 *   valid        — strong local evidence, promotion-candidate quality
 */
export function validateStagedProduct(input: ValidationInput): ValidationResult {
  const errors: string[] = [];

  if (input.pageType === "listing" || input.pageType === "non_product") {
    errors.push(`page_type '${input.pageType}' is not a product candidate`);
    return { status: "invalid", errors };
  }

  if (!input.name?.trim()) {
    errors.push("missing required field: name");
    return { status: "invalid", errors };
  }

  if (input.priceTextPresent && !input.priceParsed) {
    errors.push("price text present but not parseable");
  }
  for (const field of input.conflicts) {
    errors.push(`conflicting candidates for field: ${field}`);
  }

  const criticalUnresolved = input.unresolvedFields.filter((f) =>
    ["name", "brand", "price_text"].includes(f),
  );

  if (errors.length > 0 || criticalUnresolved.length > 0 || input.pageType === "unknown") {
    return { status: "needs_review", errors };
  }
  if (input.confidenceScore >= 0.7 && input.brandResolved) {
    return { status: "valid", errors };
  }
  return { status: "needs_review", errors };
}
