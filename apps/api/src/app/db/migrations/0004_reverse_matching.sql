ALTER TABLE "match_runs" ALTER COLUMN "patient_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "match_results" ADD COLUMN "patient_id" integer;--> statement-breakpoint
ALTER TABLE "match_results" ADD COLUMN "pseudonym" varchar(30);--> statement-breakpoint
ALTER TABLE "match_results" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
-- Existing results all come from patient runs: copy the run's patient onto each result,
-- and date existing reviews (when they were decided, else when their run finished).
UPDATE "match_results" r SET "patient_id" = p."id", "pseudonym" = p."pseudonym", "reviewed_at" = CASE WHEN r."decision" <> 'pending' OR r."note" IS NOT NULL THEN coalesce(r."decided_at", m."finished_at", m."created_at") END FROM "match_runs" m JOIN "patients" p ON p."id" = m."patient_id" WHERE m."id" = r."run_id";--> statement-breakpoint
ALTER TABLE "match_results" ALTER COLUMN "pseudonym" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "match_runs" ADD COLUMN "trial_id" integer;--> statement-breakpoint
ALTER TABLE "match_results" ADD CONSTRAINT "match_results_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_runs" ADD CONSTRAINT "match_runs_trial_id_trials_id_fk" FOREIGN KEY ("trial_id") REFERENCES "public"."trials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_results_pair_idx" ON "match_results" USING btree ("patient_id","trial_id");--> statement-breakpoint
CREATE INDEX "match_runs_trial_idx" ON "match_runs" USING btree ("trial_id","owner_id","created_at");--> statement-breakpoint
ALTER TABLE "match_runs" ADD CONSTRAINT "match_runs_one_subject" CHECK (num_nonnulls("match_runs"."patient_id", "match_runs"."trial_id") = 1);