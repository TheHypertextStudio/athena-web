CREATE TABLE "phone_number" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"e164" text NOT NULL,
	"dial_code" text NOT NULL,
	"country" text NOT NULL,
	"national_number" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"calling_enabled" boolean DEFAULT true NOT NULL,
	"verified_at" timestamp,
	"last_called_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "phone_number_status_check" CHECK ("phone_number"."status" in ('pending','verified','blocked')),
	CONSTRAINT "phone_number_e164_check" CHECK ("phone_number"."e164" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "phone_number_verified_at_check" CHECK (("phone_number"."status" = 'verified') = ("phone_number"."verified_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "phone_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"phone_number_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"consumed_at" timestamp,
	"invalidated_at" timestamp,
	"delivery_failed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "phone_verification_attempts_check" CHECK ("phone_verification"."attempts" >= 0),
	CONSTRAINT "phone_verification_max_attempts_check" CHECK ("phone_verification"."max_attempts" > 0)
);
--> statement-breakpoint
CREATE TABLE "voice_session" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"channel" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"phone_number_id" text,
	"call_sid" text,
	"provider" text NOT NULL,
	"user_turns" integer DEFAULT 0 NOT NULL,
	"assistant_turns" integer DEFAULT 0 NOT NULL,
	"interruptions" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"ended_reason" text,
	CONSTRAINT "voice_session_channel_check" CHECK ("voice_session"."channel" in ('web','phone')),
	CONSTRAINT "voice_session_status_check" CHECK ("voice_session"."status" in ('active','ended')),
	CONSTRAINT "voice_session_phone_call_sid_check" CHECK (("voice_session"."channel" = 'phone') = ("voice_session"."call_sid" is not null))
);
--> statement-breakpoint
ALTER TABLE "phone_number" ADD CONSTRAINT "phone_number_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_verification" ADD CONSTRAINT "phone_verification_phone_number_id_phone_number_id_fk" FOREIGN KEY ("phone_number_id") REFERENCES "public"."phone_number"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_session" ADD CONSTRAINT "voice_session_conversation_id_agent_session_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_session" ADD CONSTRAINT "voice_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_session" ADD CONSTRAINT "voice_session_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_session" ADD CONSTRAINT "voice_session_phone_number_id_phone_number_id_fk" FOREIGN KEY ("phone_number_id") REFERENCES "public"."phone_number"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "phone_number_verified_unique_idx" ON "phone_number" USING btree ("e164") WHERE "phone_number"."status" = 'verified';--> statement-breakpoint
CREATE UNIQUE INDEX "phone_number_user_value_idx" ON "phone_number" USING btree ("user_id","e164");--> statement-breakpoint
CREATE INDEX "phone_number_user_idx" ON "phone_number" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "phone_verification_number_idx" ON "phone_verification" USING btree ("phone_number_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_session_call_sid_idx" ON "voice_session" USING btree ("call_sid");--> statement-breakpoint
CREATE INDEX "voice_session_conversation_idx" ON "voice_session" USING btree ("conversation_id","started_at");--> statement-breakpoint
CREATE INDEX "voice_session_user_idx" ON "voice_session" USING btree ("user_id","started_at");