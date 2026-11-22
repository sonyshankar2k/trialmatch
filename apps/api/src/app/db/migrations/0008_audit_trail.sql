CREATE TYPE "public"."user_role" AS ENUM('coordinator', 'admin');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" integer,
	"actor_name" varchar(100),
	"action" varchar(40) NOT NULL,
	"entity_type" varchar(20) NOT NULL,
	"entity_id" integer,
	"label" varchar(300),
	"patient_id" integer,
	"trial_id" integer,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" varchar(100),
	"ip" varchar(64)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" "user_role" DEFAULT 'coordinator' NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_events_at_idx" ON "audit_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_events_patient_idx" ON "audit_events" USING btree ("patient_id","at");--> statement-breakpoint
CREATE INDEX "audit_events_trial_idx" ON "audit_events" USING btree ("trial_id","at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_id","at");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
-- Append-only: history can be added to, never rewritten or removed.
CREATE FUNCTION "audit_events_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "audit_events_no_update_or_delete"
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION "audit_events_append_only"();
