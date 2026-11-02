CREATE TYPE "public"."criterion_type" AS ENUM('inclusion', 'exclusion');--> statement-breakpoint
CREATE TYPE "public"."patient_sex" AS ENUM('female', 'male');--> statement-breakpoint
CREATE TYPE "public"."trial_phase" AS ENUM('Phase 1', 'Phase 2', 'Phase 3', 'Phase 4');--> statement-breakpoint
CREATE TYPE "public"."trial_sex" AS ENUM('all', 'female', 'male');--> statement-breakpoint
CREATE TYPE "public"."trial_status" AS ENUM('not_yet_recruiting', 'recruiting', 'active_not_recruiting', 'completed');--> statement-breakpoint
CREATE TABLE "patients" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" integer NOT NULL,
	"pseudonym" varchar(30) NOT NULL,
	"age" integer NOT NULL,
	"sex" "patient_sex" NOT NULL,
	"conditions" text[] DEFAULT '{}'::text[] NOT NULL,
	"medications" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trial_criteria" (
	"id" serial PRIMARY KEY NOT NULL,
	"trial_id" integer NOT NULL,
	"type" "criterion_type" NOT NULL,
	"text" text NOT NULL,
	"ordinal" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trials" (
	"id" serial PRIMARY KEY NOT NULL,
	"nct_id" varchar(11),
	"title" varchar(300) NOT NULL,
	"condition" varchar(200) NOT NULL,
	"phase" "trial_phase" NOT NULL,
	"status" "trial_status" NOT NULL,
	"sponsor" varchar(200),
	"summary" text,
	"min_age" integer,
	"max_age" integer,
	"sex" "trial_sex" DEFAULT 'all' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trials_age_range" CHECK ("trials"."min_age" IS NULL OR "trials"."max_age" IS NULL OR "trials"."min_age" <= "trials"."max_age")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(254) NOT NULL,
	"display_name" varchar(100) NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_criteria" ADD CONSTRAINT "trial_criteria_trial_id_trials_id_fk" FOREIGN KEY ("trial_id") REFERENCES "public"."trials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trials" ADD CONSTRAINT "trials_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "patients_owner_pseudonym_key" ON "patients" USING btree ("owner_id","pseudonym");--> statement-breakpoint
CREATE INDEX "trial_criteria_trial_idx" ON "trial_criteria" USING btree ("trial_id","type","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "trials_nct_id_key" ON "trials" USING btree ("nct_id");--> statement-breakpoint
CREATE INDEX "trials_status_idx" ON "trials" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");