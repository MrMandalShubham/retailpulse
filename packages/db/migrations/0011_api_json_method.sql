ALTER TABLE "staged_products" DROP CONSTRAINT "staged_products_extraction_method_check";--> statement-breakpoint
ALTER TABLE "staged_products" ADD CONSTRAINT "staged_products_extraction_method_check" CHECK ("extraction_method" IN ('api_json', 'jsonld', 'opengraph', 'meta_tags', 'dom_heuristic', 'url_hint', 'rule_inferred', 'mixed'));
