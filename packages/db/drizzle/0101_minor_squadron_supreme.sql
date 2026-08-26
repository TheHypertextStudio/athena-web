CREATE TABLE "billing_checkout_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"product_key" text NOT NULL,
	"status" text NOT NULL,
	"stripe_session_id" text,
	"checkout_url" text,
	"expires_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_credit" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"award_id" text NOT NULL,
	"status" text NOT NULL,
	"currency" text NOT NULL,
	"base_amount" integer NOT NULL,
	"tax_amount" integer DEFAULT 0 NOT NULL,
	"total_amount" integer NOT NULL,
	"service_period_starts_at" timestamp NOT NULL,
	"service_period_ends_at" timestamp NOT NULL,
	"provider_invoice_id" text NOT NULL,
	"provider_credit_note_id" text,
	"provider_preview" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"issued_at" timestamp,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_credit_amount_check" CHECK ("billing_credit"."base_amount" >= 0 AND "billing_credit"."total_amount" >= 0),
	CONSTRAINT "billing_credit_status_check" CHECK ("billing_credit"."status" IN ('previewed', 'issuing', 'issued', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "billing_discount_application" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"program_key" text NOT NULL,
	"applicant_user_id" text NOT NULL,
	"status" text NOT NULL,
	"evidence_type" text,
	"institutional_email" text,
	"ein" text,
	"request_details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"information_request" text,
	"decision_reason" text,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"information_requested_at" timestamp,
	"decided_at" timestamp,
	"expires_at" timestamp,
	"withdrawn_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_discount_application_status_check" CHECK ("billing_discount_application"."status" IN ('submitted', 'needs_information', 'approved', 'rejected', 'withdrawn', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "billing_discount_application_event" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"type" text NOT NULL,
	"reason" text,
	"actor_user_id" text,
	"staff_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_discount_award" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"application_id" text,
	"program_key" text,
	"percent_off" integer NOT NULL,
	"status" text NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"review_at" timestamp NOT NULL,
	"reason" text NOT NULL,
	"approved_by_staff_id" text,
	"provider_coupon_id" text,
	"provider_discount_id" text,
	"provider_sync_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_discount_award_percent_check" CHECK ("billing_discount_award"."percent_off" BETWEEN 1 AND 90),
	CONSTRAINT "billing_discount_award_window_check" CHECK ("billing_discount_award"."ends_at" > "billing_discount_award"."starts_at"),
	CONSTRAINT "billing_discount_award_status_check" CHECK ("billing_discount_award"."status" IN ('scheduled', 'applying', 'active', 'ending', 'expired', 'revoked', 'provider_failed'))
);
--> statement-breakpoint
CREATE TABLE "billing_discount_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"evidence_type" text NOT NULL,
	"blob_key" text NOT NULL,
	"file_name" text,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"delete_after" timestamp NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_discount_evidence_size_check" CHECK ("billing_discount_evidence"."byte_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "billing_discount_program" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"audience" text NOT NULL,
	"percent_off" integer NOT NULL,
	"review_months" integer NOT NULL,
	"terms" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_discount_program_percent_check" CHECK ("billing_discount_program"."percent_off" BETWEEN 1 AND 90),
	CONSTRAINT "billing_discount_program_review_months_check" CHECK ("billing_discount_program"."review_months" BETWEEN 1 AND 24)
);
--> statement-breakpoint
CREATE TABLE "billing_provider_event" (
	"provider_event_id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"type" text NOT NULL,
	"organization_id" text,
	"provider_created_at" timestamp NOT NULL,
	"processed_at" timestamp,
	"processing_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_provider_sync" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"award_id" text,
	"operation" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_provider_sync_attempts_check" CHECK ("billing_provider_sync"."attempts" >= 0),
	CONSTRAINT "billing_provider_sync_status_check" CHECK ("billing_provider_sync"."status" IN ('pending', 'running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "organization_billing_account" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"trial_consumed_at" timestamp,
	"billing_country" text,
	"country_verified_at" timestamp,
	"country_verification_required" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_product_entitlement" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_product_entitlement" ADD COLUMN "grace_ends_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization_product_entitlement" ADD COLUMN "provider_observed_at" timestamp;--> statement-breakpoint
ALTER TABLE "billing_checkout_attempt" ADD CONSTRAINT "billing_checkout_attempt_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_credit" ADD CONSTRAINT "billing_credit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_credit" ADD CONSTRAINT "billing_credit_award_id_billing_discount_award_id_fk" FOREIGN KEY ("award_id") REFERENCES "public"."billing_discount_award"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_discount_application" ADD CONSTRAINT "billing_discount_application_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_discount_application" ADD CONSTRAINT "billing_discount_application_program_key_billing_discount_program_key_fk" FOREIGN KEY ("program_key") REFERENCES "public"."billing_discount_program"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_discount_application" ADD CONSTRAINT "billing_discount_application_applicant_user_id_user_id_fk" FOREIGN KEY ("applicant_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_discount_application_event" ADD CONSTRAINT "billing_discount_application_event_application_id_billing_discount_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."billing_discount_application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_discount_application_event" ADD CONSTRAINT "billing_discount_application_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_discount_award" ADD CONSTRAINT "billing_discount_award_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_discount_award" ADD CONSTRAINT "billing_discount_award_application_id_billing_discount_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."billing_discount_application"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_discount_award" ADD CONSTRAINT "billing_discount_award_program_key_billing_discount_program_key_fk" FOREIGN KEY ("program_key") REFERENCES "public"."billing_discount_program"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_discount_evidence" ADD CONSTRAINT "billing_discount_evidence_application_id_billing_discount_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."billing_discount_application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_provider_event" ADD CONSTRAINT "billing_provider_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_provider_sync" ADD CONSTRAINT "billing_provider_sync_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_provider_sync" ADD CONSTRAINT "billing_provider_sync_award_id_billing_discount_award_id_fk" FOREIGN KEY ("award_id") REFERENCES "public"."billing_discount_award"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_billing_account" ADD CONSTRAINT "organization_billing_account_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_checkout_org_idx" ON "billing_checkout_attempt" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_open_org_product_uq" ON "billing_checkout_attempt" USING btree ("organization_id","product_key") WHERE "billing_checkout_attempt"."status" IN ('creating', 'open');--> statement-breakpoint
CREATE INDEX "billing_credit_org_idx" ON "billing_credit" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "billing_discount_application_org_idx" ON "billing_discount_application" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "billing_discount_application_queue_idx" ON "billing_discount_application" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_discount_application_review_org_uq" ON "billing_discount_application" USING btree ("organization_id") WHERE "billing_discount_application"."status" IN ('submitted', 'needs_information');--> statement-breakpoint
CREATE INDEX "billing_discount_application_event_idx" ON "billing_discount_application_event" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE INDEX "billing_discount_award_org_idx" ON "billing_discount_award" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_discount_award_current_org_uq" ON "billing_discount_award" USING btree ("organization_id") WHERE "billing_discount_award"."status" IN ('scheduled', 'applying', 'active', 'ending', 'provider_failed');--> statement-breakpoint
CREATE INDEX "billing_discount_evidence_delete_idx" ON "billing_discount_evidence" USING btree ("delete_after") WHERE "billing_discount_evidence"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "billing_provider_event_org_idx" ON "billing_provider_event" USING btree ("organization_id","provider_created_at");--> statement-breakpoint
CREATE INDEX "billing_provider_event_unprocessed_idx" ON "billing_provider_event" USING btree ("created_at") WHERE "billing_provider_event"."processed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_provider_sync_idempotency_uq" ON "billing_provider_sync" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "billing_provider_sync_due_idx" ON "billing_provider_sync" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_billing_customer_uq" ON "organization_billing_account" USING btree ("stripe_customer_id");