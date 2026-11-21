CREATE TYPE "public"."match_decision" AS ENUM('pending', 'shortlisted', 'dismissed');--> statement-breakpoint
ALTER TABLE "match_results" ADD COLUMN "decision" "match_decision" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "match_results" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "match_results" ADD COLUMN "decided_at" timestamp with time zone;