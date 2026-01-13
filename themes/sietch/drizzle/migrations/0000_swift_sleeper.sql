CREATE TABLE "badges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"badge_type" text NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"awarded_by" uuid,
	"revoked_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_badges_profile_type" UNIQUE("community_id","profile_id","badge_type")
);
--> statement-breakpoint
CREATE TABLE "communities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"theme_id" text DEFAULT 'basic' NOT NULL,
	"subscription_tier" text DEFAULT 'free' NOT NULL,
	"discord_guild_id" text,
	"telegram_chat_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communities_discord_guild_id_unique" UNIQUE("discord_guild_id"),
	CONSTRAINT "communities_telegram_chat_id_unique" UNIQUE("telegram_chat_id")
);
--> statement-breakpoint
CREATE TABLE "manifests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"checksum" text NOT NULL,
	"synthesized_at" timestamp with time zone DEFAULT now() NOT NULL,
	"synthesized_by" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_manifests_community_version" UNIQUE("community_id","version")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"discord_id" text,
	"telegram_id" text,
	"wallet_address" text,
	"tier" text,
	"current_rank" integer,
	"activity_score" integer DEFAULT 0 NOT NULL,
	"conviction_score" integer DEFAULT 0 NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_claim_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_profiles_discord" UNIQUE("community_id","discord_id"),
	CONSTRAINT "uq_profiles_telegram" UNIQUE("community_id","telegram_id")
);
--> statement-breakpoint
CREATE TABLE "shadow_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"manifest_version" integer NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_by" text,
	"resources" jsonb NOT NULL,
	"checksum" text NOT NULL,
	"status" text DEFAULT 'applied' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "badges" ADD CONSTRAINT "badges_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "badges" ADD CONSTRAINT "badges_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "badges" ADD CONSTRAINT "badges_awarded_by_profiles_id_fk" FOREIGN KEY ("awarded_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shadow_states" ADD CONSTRAINT "shadow_states_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_badges_profile" ON "badges" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "idx_badges_type" ON "badges" USING btree ("community_id","badge_type");--> statement-breakpoint
CREATE INDEX "idx_badges_awarded_by" ON "badges" USING btree ("awarded_by");--> statement-breakpoint
CREATE INDEX "idx_communities_theme" ON "communities" USING btree ("theme_id");--> statement-breakpoint
CREATE INDEX "idx_communities_discord_guild" ON "communities" USING btree ("discord_guild_id");--> statement-breakpoint
CREATE INDEX "idx_communities_subscription" ON "communities" USING btree ("subscription_tier");--> statement-breakpoint
CREATE INDEX "idx_manifests_community" ON "manifests" USING btree ("community_id");--> statement-breakpoint
CREATE INDEX "idx_manifests_version" ON "manifests" USING btree ("community_id","version");--> statement-breakpoint
CREATE INDEX "idx_manifests_active" ON "manifests" USING btree ("community_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_profiles_community" ON "profiles" USING btree ("community_id");--> statement-breakpoint
CREATE INDEX "idx_profiles_wallet" ON "profiles" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "idx_profiles_tier" ON "profiles" USING btree ("community_id","tier");--> statement-breakpoint
CREATE INDEX "idx_profiles_rank" ON "profiles" USING btree ("community_id","current_rank");--> statement-breakpoint
CREATE INDEX "idx_shadow_community" ON "shadow_states" USING btree ("community_id");--> statement-breakpoint
CREATE INDEX "idx_shadow_status" ON "shadow_states" USING btree ("community_id","status");