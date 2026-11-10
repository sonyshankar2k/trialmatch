CREATE TYPE "public"."trial_source" AS ENUM('manual', 'clinicaltrials_gov');--> statement-breakpoint
ALTER TYPE "public"."trial_phase" ADD VALUE 'Early Phase 1' BEFORE 'Phase 1';--> statement-breakpoint
ALTER TYPE "public"."trial_phase" ADD VALUE 'Phase 1/2' BEFORE 'Phase 2';--> statement-breakpoint
ALTER TYPE "public"."trial_phase" ADD VALUE 'Phase 2/3' BEFORE 'Phase 3';--> statement-breakpoint
ALTER TYPE "public"."trial_phase" ADD VALUE 'Not applicable';--> statement-breakpoint
ALTER TYPE "public"."trial_status" ADD VALUE 'enrolling_by_invitation' BEFORE 'active_not_recruiting';--> statement-breakpoint
ALTER TYPE "public"."trial_status" ADD VALUE 'suspended' BEFORE 'completed';--> statement-breakpoint
ALTER TYPE "public"."trial_status" ADD VALUE 'terminated' BEFORE 'completed';--> statement-breakpoint
ALTER TYPE "public"."trial_status" ADD VALUE 'withdrawn';--> statement-breakpoint
ALTER TYPE "public"."trial_status" ADD VALUE 'unknown';--> statement-breakpoint
ALTER TABLE "trials" ADD COLUMN "source" "trial_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "trials" ADD COLUMN "source_last_updated" date;