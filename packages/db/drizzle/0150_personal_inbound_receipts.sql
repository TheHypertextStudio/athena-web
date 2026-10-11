CREATE TABLE "personal_inbound_receipt" (
	"hub_id" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_inbound_receipt_hub_id_event_id_pk" PRIMARY KEY("hub_id","event_id")
);
--> statement-breakpoint
ALTER TABLE "personal_inbound_receipt" ADD CONSTRAINT "personal_inbound_receipt_hub_id_hub_id_fk" FOREIGN KEY ("hub_id") REFERENCES "public"."hub"("id") ON DELETE cascade ON UPDATE no action;