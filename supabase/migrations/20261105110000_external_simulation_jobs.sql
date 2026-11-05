-- MaxFlix / Painel Recarga: read-only simulation requests with durable
-- idempotency, independent from production renewal jobs.
-- Staged migration: deploy before the Edge Function update that uses this table.
-- NEVER add provider tokens or passwords to this table.
CREATE TABLE IF NOT EXISTS public.external_simulation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  login text NOT NULL CHECK (length(trim(login)) > 0),
  server text NOT NULL CHECK (length(trim(server)) > 0),
  expected_due_date date NOT NULL,
  idempotency_key uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  state text NOT NULL DEFAULT 'created'
    CHECK (state IN ('created','waiting','uncertain','completed','failed')),
  panel_due_date date,
  external_order_id text,
  external_message text,
  external_http_status integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- Only ONE outstanding attempt per client, regardless of tab or device.
-- Complete/failed attempts stay available for audit and later fresh checks.
CREATE UNIQUE INDEX IF NOT EXISTS external_simulation_jobs_one_pending
  ON public.external_simulation_jobs(client_id)
  WHERE state IN ('created','waiting','uncertain') AND client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS external_simulation_jobs_client_history
  ON public.external_simulation_jobs(client_id,created_at DESC);

ALTER TABLE public.external_simulation_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owner manages panel simulations" ON public.external_simulation_jobs;
CREATE POLICY "Owner manages panel simulations" ON public.external_simulation_jobs
  FOR ALL TO authenticated
  USING ((select auth.uid()) = 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid)
  WITH CHECK ((select auth.uid()) = 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid);

-- Older Lovable Cloud projects may grant ALL to anon/authenticated by default.
-- Reset these privileges explicitly before granting only necessary operations.
REVOKE ALL PRIVILEGES ON TABLE public.external_simulation_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.external_simulation_jobs TO authenticated;
-- Neither anon nor authenticated has DELETE/TRUNCATE privileges.
