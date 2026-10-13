-- Single-owner panel. Preserve ledger constraints and all existing business data.
-- Revalidate the auth UUID before applying this migration to a different project.
DO $migration$
DECLARE
  owner_id constant uuid := 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e';
  owner_predicate text;
  item record;
  table_name text;
  clauses text;
  protected_tables constant text[] := ARRAY['clients','payments','settings','resellers','reseller_sales','server_credit_movements','server_credit_alerts'];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = owner_id) THEN
    RAISE EXCEPTION 'Verified panel owner is missing. Map the owner before applying this migration.';
  END IF;
  owner_predicate := format('(select auth.uid()) = %L::uuid', owner_id);
  FOREACH table_name IN ARRAY protected_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=table_name) THEN
      RAISE EXCEPTION 'Expected policies missing for %', table_name;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, PUBLIC', table_name);
  END LOOP;
  FOR item IN SELECT * FROM pg_policies WHERE schemaname='public' AND tablename=ANY(protected_tables) LOOP
    clauses := '';
    IF item.cmd IN ('ALL','SELECT','UPDATE','DELETE') THEN
      clauses := clauses || format(' USING ((%s) AND (%s))', coalesce(item.qual,'true'), owner_predicate);
    END IF;
    IF item.cmd IN ('ALL','INSERT','UPDATE') THEN
      clauses := clauses || format(' WITH CHECK ((%s) AND (%s))', coalesce(item.with_check,item.qual,'true'), owner_predicate);
    END IF;
    EXECUTE format('ALTER POLICY %I ON public.%I TO authenticated%s', item.policyname, item.tablename, clauses);
  END LOOP;
END;
$migration$;

-- Renewals must obey the same owner-only RLS as direct table operations.
ALTER FUNCTION public.renew_client_with_credit(uuid,date,date,date,numeric,numeric,numeric,numeric,numeric) SECURITY INVOKER;
REVOKE ALL ON FUNCTION public.renew_client_with_credit(uuid,date,date,date,numeric,numeric,numeric,numeric,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renew_client_with_credit(uuid,date,date,date,numeric,numeric,numeric,numeric,numeric) TO authenticated;
