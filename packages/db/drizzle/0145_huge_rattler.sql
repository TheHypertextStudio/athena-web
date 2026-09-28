CREATE TABLE "athena_conversation_chapter" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"title" text NOT NULL,
	"start_activity_id" text NOT NULL,
	"end_activity_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "athena_conversation_chapter" ADD CONSTRAINT "athena_conversation_chapter_session_id_agent_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athena_conversation_chapter" ADD CONSTRAINT "athena_conversation_chapter_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athena_conversation_chapter" ADD CONSTRAINT "athena_conversation_chapter_owner_fk" FOREIGN KEY ("session_id","owner_user_id") REFERENCES "public"."agent_session"("id","owner_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athena_conversation_chapter" ADD CONSTRAINT "athena_conversation_chapter_start_fk" FOREIGN KEY ("start_activity_id","session_id") REFERENCES "public"."session_activity"("id","session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athena_conversation_chapter" ADD CONSTRAINT "athena_conversation_chapter_end_fk" FOREIGN KEY ("end_activity_id","session_id") REFERENCES "public"."session_activity"("id","session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "athena_conversation_chapter_session_idx" ON "athena_conversation_chapter" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "athena_conversation_chapter_open_uq" ON "athena_conversation_chapter" USING btree ("session_id") WHERE "athena_conversation_chapter"."end_activity_id" IS NULL;