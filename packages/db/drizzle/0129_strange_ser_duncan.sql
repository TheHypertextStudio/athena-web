ALTER TABLE "phone_verification" ADD COLUMN "delivery_state" text DEFAULT 'starting' NOT NULL;--> statement-breakpoint
UPDATE "phone_verification"
SET "delivery_state" = CASE
  WHEN "delivery_failed" = true THEN 'delivery_failed'
  WHEN "provider_status" = 'starting' THEN 'delivery_unknown'
  WHEN "provider" <> 'legacy_sms' AND "provider_challenge_id" IS NULL THEN 'delivery_unknown'
  ELSE 'awaiting_code'
END;--> statement-breakpoint
ALTER TABLE "phone_verification" ADD CONSTRAINT "phone_verification_delivery_state_check" CHECK ("phone_verification"."delivery_state" in ('starting','awaiting_code','delivery_unknown','delivery_failed'));
