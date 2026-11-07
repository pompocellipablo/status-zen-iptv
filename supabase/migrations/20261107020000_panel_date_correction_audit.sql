-- MaxFlix: approved technical expiry corrections with an immutable audit trail.
-- Provider date is authoritative for technical access; finance is NEVER
-- advanced by an inspection. Only the owner may approve this operation.
CREATE TABLE IF NOT EXISTS public.panel_due_date_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  client_name text NOT NULL,
  client_login text NOT NULL,
  server text NOT NULL,
  previous_due_date date NOT NULL,
  corrected_due_date date NOT NULL,
  preserved_financial_due_date date NOT NULL,
  source text NOT NULL CHECK (source IN ('arquivo','simulacao')),
  authorized_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.panel_due_date_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.panel_due_date_corrections FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.panel_due_date_corrections TO authenticated;
DROP POLICY IF EXISTS "Owner views date correction audit" ON public.panel_due_date_corrections;
CREATE POLICY "Owner views date correction audit"
  ON public.panel_due_date_corrections FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid);
DROP POLICY IF EXISTS "Owner inserts approved date correction audit" ON public.panel_due_date_corrections;
CREATE POLICY "Owner inserts approved date correction audit"
  ON public.panel_due_date_corrections FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid
    AND authorized_by = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.approve_panel_date_correction(
  p_client_id uuid,
  p_expected_login text,
  p_expected_server text,
  p_expected_due_date date,
  p_expected_financial_due_date date,
  p_panel_due_date date,
  p_source text,
  p_confirmed boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  v_client public.clients%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_actor uuid := (SELECT auth.uid());
  v_audit uuid;
BEGIN
  IF v_actor IS DISTINCT FROM 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid THEN
    RAISE EXCEPTION 'Somente o proprietário pode aprovar a correção do painel';
  END IF;
  IF p_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Confirmação explícita obrigatória';
  END IF;
  IF p_source NOT IN ('arquivo','simulacao') OR
     p_source IS NULL OR p_panel_due_date IS NULL OR
     p_expected_financial_due_date IS NULL THEN
    RAISE EXCEPTION 'Origem ou data inválida';
  END IF;

  SELECT * INTO v_client FROM public.clients WHERE id=p_client_id FOR UPDATE;
  IF NOT FOUND OR v_client.login IS DISTINCT FROM p_expected_login
    OR v_client.server IS DISTINCT FROM p_expected_server
    OR v_client.due_date IS DISTINCT FROM p_expected_due_date
    OR v_client.financial_due_date IS DISTINCT FROM p_expected_financial_due_date
  THEN RAISE EXCEPTION 'Cadastro alterado: atualize a conferência antes de corrigir'; END IF;
  IF v_client.due_date=p_panel_due_date THEN
    RAISE EXCEPTION 'O vencimento técnico já está igual ao do painel';
  END IF;
  IF p_panel_due_date<v_today THEN
    RAISE EXCEPTION 'Data do painel já passou; exige revisão financeira manual';
  END IF;
  IF v_client.financial_due_date<v_client.due_date OR
     p_panel_due_date>v_client.financial_due_date THEN
    RAISE EXCEPTION 'Correção excede a cobertura financeira, que não pode ser alterada por uma conferência';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.external_renewal_jobs j
    WHERE j.client_id=v_client.id AND j.state IN
      ('created','waiting','uncertain','external_confirmed','needs_review')
  ) THEN
    RAISE EXCEPTION 'Existe pedido externo pendente: concilie antes da correção de vencimento';
  END IF;
  -- Simulation data must be confirmed by the already-persisted server-side
  -- provider response. A browser cannot invent a due date for this source.
  IF p_source='simulacao' AND NOT EXISTS (
    SELECT 1 FROM public.external_simulation_jobs j
    WHERE j.client_id=v_client.id AND j.server=v_client.server
      AND j.login=v_client.login AND j.expected_due_date=v_client.due_date
      AND j.panel_due_date=p_panel_due_date AND j.state='completed'
      AND j.completed_at>=now()-interval '24 hours'
  ) THEN
    RAISE EXCEPTION 'Consulta autenticada ausente ou antiga: confira o painel novamente';
  END IF;

  UPDATE public.clients SET due_date=p_panel_due_date WHERE id=v_client.id;
  INSERT INTO public.panel_due_date_corrections
    (client_id,client_name,client_login,server,previous_due_date,
     corrected_due_date,preserved_financial_due_date,source,authorized_by)
  VALUES
    (v_client.id,v_client.name,v_client.login,v_client.server,v_client.due_date,
     p_panel_due_date,v_client.financial_due_date,p_source,v_actor)
  RETURNING id INTO v_audit;
  RETURN pg_catalog.jsonb_build_object(
    'ok',true,'auditId',v_audit,'dueDate',p_panel_due_date,
    'financialDueDate',v_client.financial_due_date,
    'message','Vencimento técnico corrigido por aprovação manual; financeiro, pagamentos e créditos preservados.'
  );
END
$function$;
REVOKE ALL ON FUNCTION public.approve_panel_date_correction(
 uuid,text,text,date,date,date,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approve_panel_date_correction(
 uuid,text,text,date,date,date,text,boolean) TO authenticated;
