-- Two guarantees that cannot be expressed as column definitions.
--
-- 1. `updated_at` is maintained by the database, not by application code. An
--    UPDATE that forgets to touch it would quietly falsify the audit trail.
-- 2. `audit_logs` is append-only (SPEC §13). A GRANT would not be enough: the
--    table owner bypasses privileges, and on Supabase the app connects as the
--    owner. A trigger holds for everyone, owner included.

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER mosques_set_updated_at BEFORE UPDATE ON "mosques"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER rates_set_updated_at BEFORE UPDATE ON "rates"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER households_set_updated_at BEFORE UPDATE ON "households"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER persons_set_updated_at BEFORE UPDATE ON "persons"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER collection_batches_set_updated_at BEFORE UPDATE ON "collection_batches"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER year_settlements_set_updated_at BEFORE UPDATE ON "year_settlements"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER payments_set_updated_at BEFORE UPDATE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER payment_allocations_set_updated_at BEFORE UPDATE ON "payment_allocations"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION audit_logs_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- FOR EACH STATEMENT, so an UPDATE or DELETE is rejected even when it would
-- have matched no rows — the intent is refused, not just the effect.
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_reject_mutation();
--> statement-breakpoint

-- Defence in depth for the non-owner role the API will eventually connect as.
REVOKE UPDATE, DELETE ON "audit_logs" FROM PUBLIC;
