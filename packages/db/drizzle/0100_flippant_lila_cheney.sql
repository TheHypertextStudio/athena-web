CREATE TABLE "task_related_task" (
	"task_id" text NOT NULL,
	"related_task_id" text NOT NULL,
	"organization_id" text NOT NULL,
	CONSTRAINT "task_related_task_task_id_related_task_id_pk" PRIMARY KEY("task_id","related_task_id"),
	CONSTRAINT "task_related_task_no_self" CHECK ("task_related_task"."task_id" <> "task_related_task"."related_task_id"),
	CONSTRAINT "task_related_task_canonical_order" CHECK ("task_related_task"."task_id" < "task_related_task"."related_task_id")
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "auto_complete_parent_tasks" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "template_id" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "auto_completed_by_subtasks" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "task_related_task" ADD CONSTRAINT "task_related_task_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_related_task" ADD CONSTRAINT "task_related_task_related_task_id_task_id_fk" FOREIGN KEY ("related_task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_related_task" ADD CONSTRAINT "task_related_task_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_related_task_related_idx" ON "task_related_task" USING btree ("related_task_id");--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_template_idx" ON "task" USING btree ("template_id");