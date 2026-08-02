ALTER TYPE "public"."canonical_entity_kind" ADD VALUE 'agent_session';--> statement-breakpoint
ALTER TYPE "public"."event_kind" ADD VALUE 'timer_started';--> statement-breakpoint
ALTER TYPE "public"."event_kind" ADD VALUE 'timer_paused';--> statement-breakpoint
ALTER TYPE "public"."event_kind" ADD VALUE 'timer_resumed';--> statement-breakpoint
ALTER TYPE "public"."event_kind" ADD VALUE 'timer_switched';--> statement-breakpoint
ALTER TYPE "public"."event_kind" ADD VALUE 'timer_stopped';--> statement-breakpoint
ALTER TYPE "public"."event_kind" ADD VALUE 'email_received';--> statement-breakpoint
ALTER TYPE "public"."event_kind" ADD VALUE 'elicitation_requested';--> statement-breakpoint
ALTER TYPE "public"."event_kind" ADD VALUE 'elicitation_answered';--> statement-breakpoint
ALTER TYPE "public"."event_kind" ADD VALUE 'elicitation_expired';--> statement-breakpoint
ALTER TYPE "public"."event_kind" ADD VALUE 'agent_started';--> statement-breakpoint
ALTER TYPE "public"."event_kind" ADD VALUE 'agent_progress';--> statement-breakpoint
ALTER TYPE "public"."event_kind" ADD VALUE 'agent_blocked';--> statement-breakpoint
ALTER TYPE "public"."event_kind" ADD VALUE 'agent_completed';--> statement-breakpoint
ALTER TYPE "public"."event_kind" ADD VALUE 'agent_failed';--> statement-breakpoint
ALTER TYPE "public"."event_kind" ADD VALUE 'field_change';--> statement-breakpoint
ALTER TYPE "public"."stream_relevance" ADD VALUE 'awaiting_you';