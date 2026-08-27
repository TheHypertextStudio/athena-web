-- Migration 0092 mirrored the old organization lifecycle into product entitlements. A legacy
-- trialing or active organization did not necessarily have a Stripe customer or subscription, so
-- those provider-less rows grant access that Stripe never supplied. The null provider timestamps
-- distinguish that migration residue from later cancellation and payment-failure history.
WITH "orphan_entitlements" AS MATERIALIZED (
	SELECT "entitlement"."organization_id"
	FROM "organization_product_entitlement" AS "entitlement"
	WHERE "entitlement"."product_key" = 'docket_pro'
		AND "entitlement"."source" = 'stripe'::"product_entitlement_source"
		AND "entitlement"."status" IN (
			'trialing'::"product_entitlement_status",
			'active'::"product_entitlement_status"
		)
		AND "entitlement"."stripe_subscription_id" IS NULL
		AND "entitlement"."trial_ends_at" IS NULL
		AND "entitlement"."current_period_end" IS NULL
		AND "entitlement"."grace_ends_at" IS NULL
		AND "entitlement"."provider_observed_at" IS NULL
		AND "entitlement"."canceled_at" IS NULL
		AND NOT EXISTS (
			SELECT 1
			FROM "organization_billing_account" AS "account"
			WHERE "account"."organization_id" = "entitlement"."organization_id"
				AND "account"."stripe_customer_id" IS NOT NULL
		)
),
"resolved_reconciliation" AS (
	UPDATE "billing_provider_sync" AS "sync"
	SET
		"status" = 'succeeded',
		"payload" = "sync"."payload" || jsonb_build_object(
			'resolution', 'legacy_orphan_entitlement_removed',
			'resolvedBy', '0107_billing-orphan-entitlement-repair'
		),
		"last_error" = NULL,
		"next_attempt_at" = NULL,
		"completed_at" = COALESCE("sync"."completed_at", now()),
		"updated_at" = now()
	FROM "orphan_entitlements" AS "orphan"
	WHERE "sync"."organization_id" = "orphan"."organization_id"
		AND "sync"."operation" = 'reconcile_billing'
		AND "sync"."status" IN ('pending', 'running', 'failed')
	RETURNING "sync"."id"
)
DELETE FROM "organization_product_entitlement" AS "entitlement"
USING "orphan_entitlements" AS "orphan"
WHERE "entitlement"."organization_id" = "orphan"."organization_id"
	AND "entitlement"."product_key" = 'docket_pro';
