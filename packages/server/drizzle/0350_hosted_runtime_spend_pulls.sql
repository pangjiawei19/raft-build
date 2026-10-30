CREATE TABLE "hosted_runtime_spend_pulls" (
	"day" date NOT NULL,
	"scope" text NOT NULL,
	"pull_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"completed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"last_error_code" text,
	CONSTRAINT "hosted_runtime_spend_pulls_day_scope_pk" PRIMARY KEY("day","scope")
);
