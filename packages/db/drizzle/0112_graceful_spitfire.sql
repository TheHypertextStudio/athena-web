ALTER TYPE "public"."notification_type" ADD VALUE 'phone_call';--> statement-breakpoint
CREATE TABLE "phone_call_authorization" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"phone_number_id" text,
	"destination_e164" text NOT NULL,
	"source" text NOT NULL,
	"state" text DEFAULT 'awaiting_hangup' NOT NULL,
	"inbound_call_sid" text,
	"outbound_call_sid" text,
	"stir_verification" text,
	"expires_at" timestamp NOT NULL,
	"outbound_started_at" timestamp,
	"authorized_at" timestamp,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "phone_call_authorization_source_check" CHECK ("phone_call_authorization"."source" in ('weak_inbound','docket')),
	CONSTRAINT "phone_call_authorization_state_check" CHECK ("phone_call_authorization"."state" in ('awaiting_hangup','dialing','awaiting_digit','authorized','connected','completed','failed','expired','canceled')),
	CONSTRAINT "phone_call_authorization_destination_check" CHECK ("phone_call_authorization"."destination_e164" ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
CREATE TABLE "phone_verification_rate_lock" (
	"e164" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "phone_verification" DROP CONSTRAINT "phone_verification_phone_number_id_phone_number_id_fk";
--> statement-breakpoint
ALTER TABLE "phone_verification" ALTER COLUMN "phone_number_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "phone_verification" ALTER COLUMN "code_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "phone_verification" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "phone_verification" ADD COLUMN "e164" text;--> statement-breakpoint
ALTER TABLE "phone_verification" ADD COLUMN "provider" text DEFAULT 'legacy_sms' NOT NULL;--> statement-breakpoint
ALTER TABLE "phone_verification" ADD COLUMN "provider_challenge_id" text;--> statement-breakpoint
ALTER TABLE "phone_verification" ADD COLUMN "provider_status" text;--> statement-breakpoint
UPDATE "phone_verification" AS "verification"
SET "user_id" = "number"."user_id", "e164" = "number"."e164"
FROM "phone_number" AS "number"
WHERE "verification"."phone_number_id" = "number"."id";--> statement-breakpoint
ALTER TABLE "phone_verification" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "phone_verification" ALTER COLUMN "e164" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_session" ADD COLUMN "authorization_method" text;--> statement-breakpoint
ALTER TABLE "voice_session" ADD COLUMN "stir_verification" text;--> statement-breakpoint
ALTER TABLE "phone_call_authorization" ADD CONSTRAINT "phone_call_authorization_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_call_authorization" ADD CONSTRAINT "phone_call_authorization_phone_number_id_phone_number_id_fk" FOREIGN KEY ("phone_number_id") REFERENCES "public"."phone_number"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "phone_call_authorization_inbound_sid_idx" ON "phone_call_authorization" USING btree ("inbound_call_sid");--> statement-breakpoint
CREATE UNIQUE INDEX "phone_call_authorization_outbound_sid_idx" ON "phone_call_authorization" USING btree ("outbound_call_sid");--> statement-breakpoint
CREATE UNIQUE INDEX "phone_call_authorization_active_number_idx" ON "phone_call_authorization" USING btree ("phone_number_id") WHERE "phone_call_authorization"."phone_number_id" is not null and "phone_call_authorization"."state" in ('dialing','awaiting_digit','authorized','connected');--> statement-breakpoint
CREATE INDEX "phone_call_authorization_number_idx" ON "phone_call_authorization" USING btree ("phone_number_id","created_at");--> statement-breakpoint
CREATE INDEX "phone_call_authorization_destination_idx" ON "phone_call_authorization" USING btree ("destination_e164","created_at");--> statement-breakpoint
ALTER TABLE "phone_verification" ADD CONSTRAINT "phone_verification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_verification" ADD CONSTRAINT "phone_verification_phone_number_id_phone_number_id_fk" FOREIGN KEY ("phone_number_id") REFERENCES "public"."phone_number"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "phone_verification_e164_idx" ON "phone_verification" USING btree ("e164","created_at");--> statement-breakpoint
CREATE INDEX "phone_verification_user_idx" ON "phone_verification" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "phone_verification" ADD CONSTRAINT "phone_verification_provider_check" CHECK ("phone_verification"."provider" in ('legacy_sms','twilio_verify','capture'));
