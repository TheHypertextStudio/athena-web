CREATE TYPE "public"."product_entitlement_source" AS ENUM('stripe', 'complimentary');--> statement-breakpoint
CREATE TYPE "public"."product_entitlement_status" AS ENUM('trialing', 'active', 'past_due', 'canceled');--> statement-breakpoint
CREATE TABLE "organization_product_entitlement" (
	"organization_id" text NOT NULL,
	"product_key" text NOT NULL,
	"status" "product_entitlement_status" NOT NULL,
	"source" "product_entitlement_source" NOT NULL,
	"stripe_subscription_id" text,
	"trial_ends_at" timestamp,
	"current_period_end" timestamp,
	"canceled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_product_entitlement_organization_id_product_key_pk" PRIMARY KEY("organization_id","product_key")
);
--> statement-breakpoint
ALTER TABLE "organization_product_entitlement" ADD CONSTRAINT "organization_product_entitlement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_product_status_idx" ON "organization_product_entitlement" USING btree ("product_key","status");--> statement-breakpoint
CREATE INDEX "organization_product_subscription_idx" ON "organization_product_entitlement" USING btree ("stripe_subscription_id");--> statement-breakpoint
INSERT INTO "organization_product_entitlement" (
	"organization_id",
	"product_key",
	"status",
	"source",
	"created_at",
	"updated_at"
)
SELECT
	"id",
	'docket_pro',
	CASE WHEN "lifecycle_state" = 'trialing' THEN 'trialing'::"product_entitlement_status" ELSE 'active'::"product_entitlement_status" END,
	'stripe'::"product_entitlement_source",
	now(),
	now()
FROM "organization"
WHERE "lifecycle_state" IN ('trialing', 'active');--> statement-breakpoint
INSERT INTO "organization_product_entitlement" (
	"organization_id",
	"product_key",
	"status",
	"source",
	"created_at",
	"updated_at"
)
SELECT
	"organization_id",
	'docket_pro',
	'active'::"product_entitlement_status",
	'complimentary'::"product_entitlement_source",
	"created_at",
	now()
FROM "billing_exemption"
WHERE "revoked_at" IS NULL
ON CONFLICT ("organization_id", "product_key") DO UPDATE SET
	"status" = 'active'::"product_entitlement_status",
	"source" = 'complimentary'::"product_entitlement_source",
	"updated_at" = now();
