-- One idempotency key per client and MaxFlix due-date cycle.
-- External jobs never store the provider token or passwords.
-- IMPORTANT: All state transitions are owner-only; live operation is disabled
-- unless PAINEL_RECARGA_LIVE_ENABLED=true in Edge Function secrets.
CREATE TABLE IF NOT EXISTS public.external_renewal_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  client_name text NOT NULL,
  login text NOT NULL,
  server text NOT NULL,
  expected_due_date date NOT NULL,
  new_due_date date NOT NULL,
  financial_due_date date NOT NULL,
  idempotency_key uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  local_values jsonb NOT NULL,
  state text NOT NULL DEFAULT 'created'
    CHECK (state IN ('created','waiting','uncertain','external_confirmed','synced','failed','needs_review')),
  external_order_id text,
  external_message text,
  external_http_status integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz,
  CONSTRAINT external_renewal_jobs_single_cycle UNIQUE (client_id,expected_due_date),
  CONSTRAINT external_renewal_jobs_local_values_object CHECK (jsonb_typeof(local_values) = 'object'),
  CONSTRAINT external_renewal_jobs_login_not_empty CHECK (length(trim(login)) > 0),
  CONSTRAINT external_renewal_jobs_server_not_empty CHECK (length(trim(server)) > 0)
);
CREATE INDEX IF NOT EXISTS external_renewal_jobs_state_idx ON public.external_renewal_jobs(state,created_at DESC);
ALTER TABLE public.external_renewal_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owner manages external renewal jobs" ON public.external_renewal_jobs;
CREATE POLICY "Owner manages external renewal jobs" ON public.external_renewal_jobs
FOR ALL TO authenticated
USING ((select auth.uid()) = 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid)
WITH CHECK ((select auth.uid()) = 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid);
GRANT SELECT, INSERT, UPDATE ON public.external_renewal_jobs TO authenticated;
