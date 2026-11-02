CREATE TYPE "public"."eligibility" AS ENUM('eligible', 'possibly_eligible', 'not_eligible');--> statement-breakpoint
CREATE TYPE "public"."match_run_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "match_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"trial_id" integer,
	"nct_id" varchar(11),
	"title" varchar(300) NOT NULL,
	"condition" varchar(200) NOT NULL,
	"eligibility" "eligibility" NOT NULL,
	"score" integer NOT NULL,
	"summary" text NOT NULL,
	"assessments" jsonb NOT NULL,
	"rank" integer NOT NULL,
	"reviewed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"owner_id" integer NOT NULL,
	"status" "match_run_status" DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"stage" varchar(200) DEFAULT 'Waiting for a worker' NOT NULL,
	"engine" varchar(20),
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "trials" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || condition || ' ' || coalesce(summary, ''))) STORED;--> statement-breakpoint
ALTER TABLE "match_results" ADD CONSTRAINT "match_results_run_id_match_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."match_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_results" ADD CONSTRAINT "match_results_trial_id_trials_id_fk" FOREIGN KEY ("trial_id") REFERENCES "public"."trials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_runs" ADD CONSTRAINT "match_runs_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_runs" ADD CONSTRAINT "match_runs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_results_run_idx" ON "match_results" USING btree ("run_id","rank");--> statement-breakpoint
CREATE INDEX "match_runs_patient_idx" ON "match_runs" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE INDEX "trials_search_idx" ON "trials" USING gin ("search_vector");