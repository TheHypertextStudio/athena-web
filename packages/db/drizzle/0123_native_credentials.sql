CREATE TABLE "restore_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"aaguid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "passkey" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "restore_credential" ADD CONSTRAINT "restore_credential_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "restore_credential_user_id_idx" ON "restore_credential" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "restore_credential_credential_id_idx" ON "restore_credential" USING btree ("credential_id");