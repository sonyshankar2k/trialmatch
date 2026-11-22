CREATE TYPE "public"."trial_update_status" AS ENUM('pending', 'applied', 'dismissed');--> statement-breakpoint
CREATE TABLE "trial_updates" (
	"id" serial PRIMARY KEY NOT NULL,
	"trial_id" integer NOT NULL,
	"registry_last_updated" date,
	"fields" jsonb NOT NULL,
	"criteria" jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"warnings" jsonb NOT NULL,
	"status" "trial_update_status" DEFAULT 'pending' NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_id" integer
);
--> statement-breakpoint
ALTER TABLE "trials" ADD COLUMN "source_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "trials" ADD COLUMN "source_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trial_updates" ADD CONSTRAINT "trial_updates_trial_id_trials_id_fk" FOREIGN KEY ("trial_id") REFERENCES "public"."trials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_updates" ADD CONSTRAINT "trial_updates_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trial_updates_one_pending" ON "trial_updates" USING btree ("trial_id") WHERE "trial_updates"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "trial_updates_trial_idx" ON "trial_updates" USING btree ("trial_id","detected_at");