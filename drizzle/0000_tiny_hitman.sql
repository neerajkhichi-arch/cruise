CREATE TABLE "account_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"company_name" text DEFAULT 'Girnar Motors Retail Group' NOT NULL,
	"default_target_cpl" double precision DEFAULT 80 NOT NULL,
	"monthly_budget_cap" double precision DEFAULT 5000000 NOT NULL,
	"low_inventory_threshold" integer DEFAULT 300 NOT NULL,
	"old_inventory_days" integer DEFAULT 60 NOT NULL,
	"avg_deal_margin" double precision DEFAULT 25000 NOT NULL,
	"email_alerts" boolean DEFAULT true NOT NULL,
	"slack_alerts" boolean DEFAULT true NOT NULL,
	"whatsapp_alerts" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"city_id" text,
	"name" text NOT NULL,
	"status" text DEFAULT 'PAUSED' NOT NULL,
	"optimization_goal" text NOT NULL,
	"result_type" text NOT NULL,
	"attribution_setting" text NOT NULL,
	"geo_cities" text DEFAULT '[]' NOT NULL,
	"geo_regions" text DEFAULT '[]' NOT NULL,
	"custom_audiences" text DEFAULT '[]' NOT NULL,
	"lookalike_source" text,
	"catalogue_id" text,
	"catalogue_name" text,
	"product_set_id" text,
	"product_set_name" text,
	"product_set_filter" text,
	"product_count" integer DEFAULT 0 NOT NULL,
	"excluded_audiences" text DEFAULT '[]' NOT NULL,
	"interests" text DEFAULT '[]' NOT NULL,
	"age_min" integer DEFAULT 18 NOT NULL,
	"age_max" integer DEFAULT 65 NOT NULL,
	"genders" text DEFAULT '[]' NOT NULL,
	"advantage_audience" boolean DEFAULT false NOT NULL,
	"targeting_optimization" text,
	"daily_budget" double precision DEFAULT 0 NOT NULL,
	"spend" double precision DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"reach" integer DEFAULT 0 NOT NULL,
	"frequency" double precision DEFAULT 0 NOT NULL,
	"results" integer DEFAULT 0 NOT NULL,
	"cost_per_result" double precision DEFAULT 0 NOT NULL,
	"spend_7d" double precision DEFAULT 0 NOT NULL,
	"results_7d" integer DEFAULT 0 NOT NULL,
	"cost_per_result_7d" double precision DEFAULT 0 NOT NULL,
	"frequency_7d" double precision DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"city_id" text,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text,
	"user_email" text,
	"account_id" text,
	"action" text NOT NULL,
	"subject" text,
	"detail" text,
	"ok" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_cities" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"city_id" text NOT NULL,
	"budget_share" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"objective" text DEFAULT 'LEADS' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"structure_type" text DEFAULT 'STANDARD_CITY' NOT NULL,
	"audience_type" text DEFAULT 'BROAD' NOT NULL,
	"inventory_filter" text NOT NULL,
	"daily_budget" double precision NOT NULL,
	"total_budget" double precision NOT NULL,
	"target_cpl" double precision NOT NULL,
	"catalogue_name" text DEFAULT 'UsedCars-Master-Catalogue' NOT NULL,
	"performance_score" integer DEFAULT 50 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"state" text NOT NULL,
	"tier" text DEFAULT 'Tier 1' NOT NULL,
	"status" text DEFAULT 'HEALTHY' NOT NULL,
	"daily_budget" double precision DEFAULT 0 NOT NULL,
	"recommended_budget" double precision DEFAULT 0 NOT NULL,
	"target_cpl" double precision DEFAULT 80 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cities_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"city_id" text NOT NULL,
	"vehicle_id" text,
	"stage" text DEFAULT 'LEAD' NOT NULL,
	"source" text DEFAULT 'Meta Lead Form' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"business_name" text,
	"catalogue_id" text,
	"conversion_event" text,
	"lead_targets_csv_url" text,
	"max_daily_budget" double precision,
	"is_default" boolean DEFAULT false NOT NULL,
	"client_name" text,
	"access_token_encrypted" text,
	"token_expires_at" timestamp with time zone,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_integration" (
	"id" text PRIMARY KEY NOT NULL,
	"connected" boolean DEFAULT false NOT NULL,
	"business_manager" text,
	"ad_account_id" text,
	"ad_account_name" text,
	"page_id" text,
	"page_name" text,
	"ig_account_id" text,
	"ig_username" text,
	"catalogue_id" text,
	"catalogue_name" text,
	"pixel_id" text,
	"capi_enabled" boolean DEFAULT false NOT NULL,
	"connected_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "naming_convention" (
	"id" text PRIMARY KEY NOT NULL,
	"template" text DEFAULT 'UC | META | {OBJECTIVE} | {CITY} | CATALOGUE | {AUDIENCE}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "optimisation_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"params" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "optimisation_rules_type_unique" UNIQUE("type")
);
--> statement-breakpoint
CREATE TABLE "performance_daily" (
	"id" text PRIMARY KEY NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"campaign_id" text NOT NULL,
	"ad_set_id" text,
	"city_id" text NOT NULL,
	"spend" double precision NOT NULL,
	"impressions" integer NOT NULL,
	"clicks" integer NOT NULL,
	"leads" integer NOT NULL,
	"result_type" text DEFAULT 'PIXEL_LEAD' NOT NULL,
	"attribution_setting" text DEFAULT '1d_click' NOT NULL,
	"reach" integer DEFAULT 0 NOT NULL,
	"frequency" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text DEFAULT 'AI' NOT NULL,
	"rule_type" text,
	"scope" text NOT NULL,
	"title" text NOT NULL,
	"reasons" text NOT NULL,
	"recommended_action" text NOT NULL,
	"impact_estimate" text,
	"suggested_daily_budget" double precision,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"city_id" text,
	"campaign_id" text,
	"vehicle_id" text,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_id" text
);
--> statement-breakpoint
CREATE TABLE "user_accounts" (
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"can_edit" boolean DEFAULT false NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by_id" text,
	CONSTRAINT "user_accounts_user_id_account_id_pk" PRIMARY KEY("user_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'VIEWER' NOT NULL,
	"avatar_color" text DEFAULT '#1a73e8' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicle_code" text NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"variant" text NOT NULL,
	"year" integer NOT NULL,
	"price" double precision NOT NULL,
	"previous_price" double precision,
	"fuel" text NOT NULL,
	"transmission" text NOT NULL,
	"km_driven" integer NOT NULL,
	"city_id" text NOT NULL,
	"dealer" text NOT NULL,
	"images" text NOT NULL,
	"vehicle_url" text NOT NULL,
	"availability" text DEFAULT 'ACTIVE' NOT NULL,
	"listed_at" timestamp with time zone NOT NULL,
	"sold_at" timestamp with time zone,
	"health_score" integer DEFAULT 70 NOT NULL,
	"performance_score" integer DEFAULT 50 NOT NULL,
	"spend" double precision DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"leads" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_vehicle_code_unique" UNIQUE("vehicle_code")
);
--> statement-breakpoint
ALTER TABLE "ad_sets" ADD CONSTRAINT "ad_sets_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_sets" ADD CONSTRAINT "ad_sets_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_cities" ADD CONSTRAINT "campaign_cities_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_cities" ADD CONSTRAINT "campaign_cities_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_daily" ADD CONSTRAINT "performance_daily_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_daily" ADD CONSTRAINT "performance_daily_ad_set_id_ad_sets_id_fk" FOREIGN KEY ("ad_set_id") REFERENCES "public"."ad_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_daily" ADD CONSTRAINT "performance_daily_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_account_id_meta_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."meta_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_granted_by_id_users_id_fk" FOREIGN KEY ("granted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adsets_campaign_idx" ON "ad_sets" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "adsets_city_idx" ON "ad_sets" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "adsets_cohort_idx" ON "ad_sets" USING btree ("result_type","attribution_setting");--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_account_idx" ON "audit_log" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_city_uniq" ON "campaign_cities" USING btree ("campaign_id","city_id");--> statement-breakpoint
CREATE INDEX "leads_city_idx" ON "leads" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "leads_campaign_idx" ON "leads" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "perf_campaign_date_idx" ON "performance_daily" USING btree ("campaign_id","date");--> statement-breakpoint
CREATE INDEX "perf_city_date_idx" ON "performance_daily" USING btree ("city_id","date");--> statement-breakpoint
CREATE INDEX "user_accounts_user_idx" ON "user_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vehicles_city_idx" ON "vehicles" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "vehicles_availability_idx" ON "vehicles" USING btree ("availability");