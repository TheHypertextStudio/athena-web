DROP INDEX "agent_delegation_open_task_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "agent_delegation_open_task_uq" ON "agent_delegation" USING btree ("task_id") WHERE status <> 'failed';