CREATE TABLE "meta_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"account_id" text,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"written_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "meta_cache_expires_idx" ON "meta_cache" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "meta_cooldowns" ADD COLUMN "strikes" integer DEFAULT 0 NOT NULL;
