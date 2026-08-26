INSERT INTO "billing_discount_program" (
	"key",
	"name",
	"audience",
	"percent_off",
	"review_months",
	"terms"
) VALUES
	('student', 'Student', 'student', 50, 12, 'Verified students receive 50% off Docket Pro for their personal workspace for 12 months.'),
	('nonprofit', 'Nonprofit', 'nonprofit', 50, 12, 'Verified nonprofit organizations receive 50% off Docket Pro with annual eligibility review.')
ON CONFLICT ("key") DO UPDATE SET
	"name" = EXCLUDED."name",
	"audience" = EXCLUDED."audience",
	"percent_off" = EXCLUDED."percent_off",
	"review_months" = EXCLUDED."review_months",
	"terms" = EXCLUDED."terms",
	"active" = true,
	"updated_at" = now();
--> statement-breakpoint
-- Preserve legacy payment failures as a seven-day entitlement grace period before the
-- organization lifecycle stops representing billing state.
INSERT INTO "organization_product_entitlement" (
	"organization_id",
	"product_key",
	"status",
	"source",
	"grace_ends_at",
	"provider_observed_at",
	"created_at",
	"updated_at"
)
SELECT
	"id",
	'docket_pro',
	'past_due'::"product_entitlement_status",
	'stripe'::"product_entitlement_source",
	now() + interval '7 days',
	now(),
	now(),
	now()
FROM "organization"
WHERE "lifecycle_state" = 'past_due'
ON CONFLICT ("organization_id", "product_key") DO UPDATE SET
	"status" = 'past_due'::"product_entitlement_status",
	"source" = 'stripe'::"product_entitlement_source",
	"grace_ends_at" = now() + interval '7 days',
	"provider_observed_at" = now(),
	"updated_at" = now()
WHERE "organization_product_entitlement"."source" <> 'complimentary'::"product_entitlement_source";
--> statement-breakpoint
-- Preserve legacy export and pending-deletion organizations as read-only without retaining any
-- billing-created deletion deadline. Complimentary grants remain active.
INSERT INTO "organization_product_entitlement" (
	"organization_id",
	"product_key",
	"status",
	"source",
	"canceled_at",
	"provider_observed_at",
	"created_at",
	"updated_at"
)
SELECT
	"id",
	'docket_pro',
	'canceled'::"product_entitlement_status",
	'stripe'::"product_entitlement_source",
	now(),
	now(),
	now(),
	now()
FROM "organization"
WHERE "lifecycle_state" IN ('export_window', 'pending_deletion')
ON CONFLICT ("organization_id", "product_key") DO UPDATE SET
	"status" = 'canceled'::"product_entitlement_status",
	"source" = 'stripe'::"product_entitlement_source",
	"grace_ends_at" = NULL,
	"canceled_at" = now(),
	"provider_observed_at" = now(),
	"updated_at" = now()
WHERE "organization_product_entitlement"."source" <> 'complimentary'::"product_entitlement_source";
--> statement-breakpoint
-- Organization lifecycle now represents deletion only. Billing cancellation and failure live on
-- the product entitlement, so neither state can schedule organization deletion.
UPDATE "organization"
SET
	"lifecycle_state" = 'active',
	"export_ready_at" = NULL,
	"delete_after_at" = NULL,
	"updated_at" = now()
WHERE "lifecycle_state" IN ('trialing', 'past_due', 'export_window', 'pending_deletion');
