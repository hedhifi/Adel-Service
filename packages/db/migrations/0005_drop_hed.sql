-- HED is a separate business and is not a brand in this app.
-- Delete the HED brand and the records that exist only for it.
-- Do not relabel those rows as Adel Electric. Adel Electric and Service Contracts stay.
DELETE FROM "payments"
WHERE "invoice_id" IN (
  SELECT "id" FROM "invoices"
  WHERE "brand_id" IN (SELECT "id" FROM "brands" WHERE lower("slug") = 'hed' OR lower("name") IN ('hed', 'home entertainment design'))
     OR "customer_id" IN (SELECT "id" FROM "customers" WHERE "brand_id" IN (SELECT "id" FROM "brands" WHERE lower("slug") = 'hed' OR lower("name") IN ('hed', 'home entertainment design')))
);
--> statement-breakpoint
DELETE FROM "invoices"
WHERE "brand_id" IN (SELECT "id" FROM "brands" WHERE lower("slug") = 'hed' OR lower("name") IN ('hed', 'home entertainment design'))
   OR "customer_id" IN (SELECT "id" FROM "customers" WHERE "brand_id" IN (SELECT "id" FROM "brands" WHERE lower("slug") = 'hed' OR lower("name") IN ('hed', 'home entertainment design')))
   OR "job_id" IN (SELECT "id" FROM "jobs" WHERE "brand_id" IN (SELECT "id" FROM "brands" WHERE lower("slug") = 'hed' OR lower("name") IN ('hed', 'home entertainment design')));
--> statement-breakpoint
DELETE FROM "jobs"
WHERE "brand_id" IN (SELECT "id" FROM "brands" WHERE lower("slug") = 'hed' OR lower("name") IN ('hed', 'home entertainment design'))
   OR "customer_id" IN (SELECT "id" FROM "customers" WHERE "brand_id" IN (SELECT "id" FROM "brands" WHERE lower("slug") = 'hed' OR lower("name") IN ('hed', 'home entertainment design')))
   OR "quote_id" IN (SELECT "id" FROM "quotes" WHERE "brand_id" IN (SELECT "id" FROM "brands" WHERE lower("slug") = 'hed' OR lower("name") IN ('hed', 'home entertainment design')));
--> statement-breakpoint
DELETE FROM "quotes"
WHERE "brand_id" IN (SELECT "id" FROM "brands" WHERE lower("slug") = 'hed' OR lower("name") IN ('hed', 'home entertainment design'))
   OR "customer_id" IN (SELECT "id" FROM "customers" WHERE "brand_id" IN (SELECT "id" FROM "brands" WHERE lower("slug") = 'hed' OR lower("name") IN ('hed', 'home entertainment design')));
--> statement-breakpoint
DELETE FROM "requests"
WHERE "brand_id" IN (SELECT "id" FROM "brands" WHERE lower("slug") = 'hed' OR lower("name") IN ('hed', 'home entertainment design'))
   OR "customer_id" IN (SELECT "id" FROM "customers" WHERE "brand_id" IN (SELECT "id" FROM "brands" WHERE lower("slug") = 'hed' OR lower("name") IN ('hed', 'home entertainment design')));
--> statement-breakpoint
DELETE FROM "contracts"
WHERE "customer_id" IN (SELECT "id" FROM "customers" WHERE "brand_id" IN (SELECT "id" FROM "brands" WHERE lower("slug") = 'hed' OR lower("name") IN ('hed', 'home entertainment design')));
--> statement-breakpoint
DELETE FROM "entity_links"
WHERE "from_record_id" IN (SELECT "id" FROM "customers" WHERE "brand_id" IN (SELECT "id" FROM "brands" WHERE lower("slug") = 'hed' OR lower("name") IN ('hed', 'home entertainment design')))
   OR "to_record_id" IN (SELECT "id" FROM "customers" WHERE "brand_id" IN (SELECT "id" FROM "brands" WHERE lower("slug") = 'hed' OR lower("name") IN ('hed', 'home entertainment design')));
--> statement-breakpoint
DELETE FROM "form_templates"
WHERE "brand_id" IN (SELECT "id" FROM "brands" WHERE lower("slug") = 'hed' OR lower("name") IN ('hed', 'home entertainment design'));
--> statement-breakpoint
DELETE FROM "customers"
WHERE "brand_id" IN (SELECT "id" FROM "brands" WHERE lower("slug") = 'hed' OR lower("name") IN ('hed', 'home entertainment design'));
--> statement-breakpoint
DELETE FROM "brands"
WHERE lower("slug") = 'hed' OR lower("name") IN ('hed', 'home entertainment design');
