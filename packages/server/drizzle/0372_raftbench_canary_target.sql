ALTER TABLE "agent_runtime_provisions" ADD COLUMN "provider_target" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runtime_provisions" ADD CONSTRAINT "agent_runtime_provisions_target_check" CHECK ("agent_runtime_provisions"."provider_target" IN ('default', 'canary'));--> statement-breakpoint
ALTER TABLE "agent_runtime_provisions" ADD CONSTRAINT "agent_runtime_provisions_canary_profile_check" CHECK ("agent_runtime_provisions"."provider_target" = 'default' OR "agent_runtime_provisions"."provisioned_profile" IS NOT DISTINCT FROM 'raftbench_service');
--> statement-breakpoint
CREATE FUNCTION prevent_provider_target_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.provider_target IS DISTINCT FROM OLD.provider_target THEN
    RAISE EXCEPTION 'Provider target is immutable; create a separate provision' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER agent_runtime_provisions_target_immutable
BEFORE UPDATE OF provider_target ON agent_runtime_provisions
FOR EACH ROW EXECUTE FUNCTION prevent_provider_target_change();
