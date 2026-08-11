CREATE TYPE "public"."batch_status" AS ENUM('open', 'closed', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."entry_reason" AS ENUM('birth', 'married_in', 'moved_in', 'other');--> statement-breakpoint
CREATE TYPE "public"."exit_reason" AS ENUM('deceased', 'married_out', 'moved_out', 'other');--> statement-breakpoint
CREATE TYPE "public"."household_status" AS ENUM('active', 'dissolved');--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('sq', 'en');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('super_admin', 'imam', 'collector', 'member');--> statement-breakpoint
CREATE TYPE "public"."settlement_source" AS ENUM('legacy_import', 'manual');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('pending', 'active', 'rejected', 'disabled');--> statement-breakpoint
CREATE TABLE "mosques" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"village" text NOT NULL,
	"ledger_start_year" integer NOT NULL,
	"commission_percent" integer DEFAULT 10 NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"default_locale" "locale" DEFAULT 'sq' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mosques_commission_percent_range" CHECK ("mosques"."commission_percent" >= 0 AND "mosques"."commission_percent" <= 100),
	CONSTRAINT "mosques_ledger_start_year_range" CHECK ("mosques"."ledger_start_year" BETWEEN 1900 AND 2200)
);
--> statement-breakpoint
CREATE TABLE "rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mosque_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rates_mosque_year_unique" UNIQUE("mosque_id","year"),
	CONSTRAINT "rates_amount_positive" CHECK ("rates"."amount_cents" > 0),
	CONSTRAINT "rates_year_range" CHECK ("rates"."year" BETWEEN 1900 AND 2200)
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mosque_id" uuid NOT NULL,
	"status" "household_status" DEFAULT 'active' NOT NULL,
	"neighbourhood" text,
	"phone" text,
	"notes" text,
	"claim_code" text,
	"claim_code_used_at" timestamp with time zone,
	"needs_review" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "households_id_mosque_unique" UNIQUE("id","mosque_id")
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mosque_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"father_name" text NOT NULL,
	"last_name" text NOT NULL,
	"joined_year" integer NOT NULL,
	"left_year" integer,
	"entry_reason" "entry_reason",
	"exit_reason" "exit_reason",
	"is_head" boolean DEFAULT false NOT NULL,
	"lives_abroad" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persons_left_year_after_joined" CHECK ("persons"."left_year" IS NULL OR "persons"."left_year" >= "persons"."joined_year"),
	CONSTRAINT "persons_exit_reason_needs_left_year" CHECK ("persons"."left_year" IS NOT NULL OR "persons"."exit_reason" IS NULL),
	CONSTRAINT "persons_joined_year_range" CHECK ("persons"."joined_year" BETWEEN 1900 AND 2200),
	CONSTRAINT "persons_left_year_range" CHECK ("persons"."left_year" IS NULL OR "persons"."left_year" BETWEEN 1900 AND 2200)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mosque_id" uuid,
	"phone" text NOT NULL,
	"pin_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"status" "user_status" DEFAULT 'pending' NOT NULL,
	"household_id" uuid,
	"identity_verified" boolean DEFAULT false NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"id_photo_key" text,
	"id_photo_uploaded_at" timestamp with time zone,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_unique" UNIQUE("phone"),
	CONSTRAINT "users_member_needs_household" CHECK ("users"."role" <> 'member' OR "users"."household_id" IS NOT NULL),
	CONSTRAINT "users_tenant_scoped" CHECK ("users"."role" = 'super_admin' OR "users"."mosque_id" IS NOT NULL),
	CONSTRAINT "users_failed_attempts_non_negative" CHECK ("users"."failed_login_attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "collection_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mosque_id" uuid NOT NULL,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"status" "batch_status" DEFAULT 'open' NOT NULL,
	"gross_collected_cents" integer DEFAULT 0 NOT NULL,
	"commission_percent" integer,
	"commission_cents" integer,
	"net_to_mosque_cents" integer,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"discrepancy_cents" integer,
	"discrepancy_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batches_mosque_period_unique" UNIQUE("mosque_id","period_year","period_month"),
	CONSTRAINT "batches_id_mosque_unique" UNIQUE("id","mosque_id"),
	CONSTRAINT "batches_period_month_range" CHECK ("collection_batches"."period_month" BETWEEN 1 AND 12),
	CONSTRAINT "batches_period_year_range" CHECK ("collection_batches"."period_year" BETWEEN 1900 AND 2200),
	CONSTRAINT "batches_gross_non_negative" CHECK ("collection_batches"."gross_collected_cents" >= 0),
	CONSTRAINT "batches_separation_of_duties" CHECK ("collection_batches"."confirmed_by" IS NULL OR "collection_batches"."closed_by" IS NULL OR "collection_batches"."confirmed_by" <> "collection_batches"."closed_by"),
	CONSTRAINT "batches_closed_has_figures" CHECK ("collection_batches"."status" = 'open' OR ("collection_batches"."closed_by" IS NOT NULL AND "collection_batches"."closed_at" IS NOT NULL
           AND "collection_batches"."commission_percent" IS NOT NULL AND "collection_batches"."commission_cents" IS NOT NULL
           AND "collection_batches"."net_to_mosque_cents" IS NOT NULL)),
	CONSTRAINT "batches_confirmed_has_confirmer" CHECK ("collection_batches"."status" <> 'confirmed' OR ("collection_batches"."confirmed_by" IS NOT NULL AND "collection_batches"."confirmed_at" IS NOT NULL)),
	CONSTRAINT "batches_split_sums_to_gross" CHECK ("collection_batches"."commission_cents" IS NULL OR "collection_batches"."net_to_mosque_cents" IS NULL
          OR "collection_batches"."commission_cents" + "collection_batches"."net_to_mosque_cents" = "collection_batches"."gross_collected_cents")
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mosque_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_allocations_payment_year_unique" UNIQUE("payment_id","year"),
	CONSTRAINT "payment_allocations_amount_positive" CHECK ("payment_allocations"."amount_cents" > 0),
	CONSTRAINT "payment_allocations_year_range" CHECK ("payment_allocations"."year" BETWEEN 1900 AND 2200)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mosque_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"batch_id" uuid,
	"client_uuid" uuid NOT NULL,
	"paid_at" date NOT NULL,
	"total_cents" integer NOT NULL,
	"receipt_number" text NOT NULL,
	"collected_by" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_client_uuid_unique" UNIQUE("client_uuid"),
	CONSTRAINT "payments_id_mosque_unique" UNIQUE("id","mosque_id"),
	CONSTRAINT "payments_total_positive" CHECK ("payments"."total_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "year_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mosque_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"source" "settlement_source" NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "year_settlements_household_year_unique" UNIQUE("household_id","year"),
	CONSTRAINT "year_settlements_year_range" CHECK ("year_settlements"."year" BETWEEN 1900 AND 2200)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mosque_id" uuid,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rates" ADD CONSTRAINT "rates_mosque_id_mosques_id_fk" FOREIGN KEY ("mosque_id") REFERENCES "public"."mosques"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_mosque_id_mosques_id_fk" FOREIGN KEY ("mosque_id") REFERENCES "public"."mosques"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_mosque_id_mosques_id_fk" FOREIGN KEY ("mosque_id") REFERENCES "public"."mosques"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_household_fk" FOREIGN KEY ("household_id","mosque_id") REFERENCES "public"."households"("id","mosque_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_mosque_id_mosques_id_fk" FOREIGN KEY ("mosque_id") REFERENCES "public"."mosques"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_household_fk" FOREIGN KEY ("household_id","mosque_id") REFERENCES "public"."households"("id","mosque_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_batches" ADD CONSTRAINT "collection_batches_mosque_id_mosques_id_fk" FOREIGN KEY ("mosque_id") REFERENCES "public"."mosques"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_batches" ADD CONSTRAINT "collection_batches_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_batches" ADD CONSTRAINT "collection_batches_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_fk" FOREIGN KEY ("payment_id","mosque_id") REFERENCES "public"."payments"("id","mosque_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_mosque_id_mosques_id_fk" FOREIGN KEY ("mosque_id") REFERENCES "public"."mosques"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_collected_by_users_id_fk" FOREIGN KEY ("collected_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_household_fk" FOREIGN KEY ("household_id","mosque_id") REFERENCES "public"."households"("id","mosque_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_batch_fk" FOREIGN KEY ("batch_id","mosque_id") REFERENCES "public"."collection_batches"("id","mosque_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_settlements" ADD CONSTRAINT "year_settlements_mosque_id_mosques_id_fk" FOREIGN KEY ("mosque_id") REFERENCES "public"."mosques"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_settlements" ADD CONSTRAINT "year_settlements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_settlements" ADD CONSTRAINT "year_settlements_household_fk" FOREIGN KEY ("household_id","mosque_id") REFERENCES "public"."households"("id","mosque_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_mosque_id_mosques_id_fk" FOREIGN KEY ("mosque_id") REFERENCES "public"."mosques"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "households_claim_code_unique" ON "households" USING btree ("mosque_id","claim_code") WHERE claim_code IS NOT NULL;--> statement-breakpoint
CREATE INDEX "households_mosque_idx" ON "households" USING btree ("mosque_id");--> statement-breakpoint
CREATE INDEX "households_neighbourhood_idx" ON "households" USING btree ("mosque_id","neighbourhood");--> statement-breakpoint
CREATE UNIQUE INDEX "persons_one_head_per_household" ON "persons" USING btree ("household_id") WHERE is_head AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "persons_household_idx" ON "persons" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "persons_mosque_idx" ON "persons" USING btree ("mosque_id");--> statement-breakpoint
CREATE INDEX "users_mosque_idx" ON "users" USING btree ("mosque_id");--> statement-breakpoint
CREATE INDEX "users_pending_idx" ON "users" USING btree ("mosque_id","status");--> statement-breakpoint
CREATE INDEX "batches_mosque_status_idx" ON "collection_batches" USING btree ("mosque_id","status");--> statement-breakpoint
CREATE INDEX "payment_allocations_mosque_year_idx" ON "payment_allocations" USING btree ("mosque_id","year");--> statement-breakpoint
CREATE INDEX "payments_receipt_number_idx" ON "payments" USING btree ("mosque_id","receipt_number");--> statement-breakpoint
CREATE INDEX "payments_household_idx" ON "payments" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "payments_paid_at_idx" ON "payments" USING btree ("mosque_id","paid_at");--> statement-breakpoint
CREATE INDEX "payments_batch_idx" ON "payments" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "year_settlements_mosque_idx" ON "year_settlements" USING btree ("mosque_id");--> statement-breakpoint
CREATE INDEX "audit_logs_mosque_created_idx" ON "audit_logs" USING btree ("mosque_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id");