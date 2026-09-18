CREATE TABLE "meta_cooldowns" (
	"account_id" text PRIMARY KEY NOT NULL,
	"until" timestamp with time zone NOT NULL,
	"reason" text,
	"noticed_at" timestamp with time zone DEFAULT now() NOT NULL
);
