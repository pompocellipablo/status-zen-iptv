-- A manual override is allowed ONLY AFTER an owner records cancellation of the
-- SAME external order at Painel Recarga. This function DOES NOT cancel the order.
-- Never unlock confirmed, synced, or needs_review (possibly executed) requests.
ALTER TABLE public.external_renewal_jobs
  DROP CONSTRAINT IF EXISTS external_renewal_jobs_state_check;
ALTER TABLE public.external_renewal_jobs
  ADD CONSTRAINT external_renewal_jobs_state_check
  CHECK (state IN ('created','waiting','uncertain','external_confirmed',
     'synced','failed','needs_review','cancelled'));

CREATE TABLE IF NOT EXISTS public.external_renewal_cancellations (
  job_id uuid PRIMARY KEY REFERENCES public.external_renewal_jobs(id),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  external_order_id text NOT NULL,
  old_state text NOT NULL,
  cancelled_by uuid NOT NULL,
  evidence text NOT NULL CHECK(length(trim(evidence)) BETWEEN 12 AND 500),
  acknowledged_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.external_renewal_cancellations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owner reads cancellation audit" ON public.external_renewal_cancellations;
CREATE POLICY "Owner reads cancellation audit"
ON public.external_renewal_cancellations FOR SELECT TO authenticated
USING ((select auth.uid())='c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid);
GRANT SELECT ON public.external_renewal_cancellations TO authenticated;

CREATE OR REPLACE FUNCTION public.record_panel_cancelled_for_manual(
  p_job_id uuid,p_order_id text,p_confirm_text text,p_evidence text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  v_owner CONSTANT uuid := 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e';
  v_job public.external_renewal_jobs%ROWTYPE;
  v_client public.clients%ROWTYPE;
BEGIN
  IF (SELECT auth.uid()) IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'Apenas o proprietário pode registrar cancelamento';
  END IF;
  IF p_confirm_text IS DISTINCT FROM 'CANCELADO' OR
     length(trim(COALESCE(p_evidence,''))) NOT BETWEEN 12 AND 500 THEN
    RAISE EXCEPTION 'Confirme o cancelamento real e descreva a comprovação';
  END IF;
  SELECT * INTO v_job FROM public.external_renewal_jobs
  WHERE id=p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido externo não encontrado'; END IF;
  IF v_job.state NOT IN ('waiting','uncertain','failed') THEN
    RAISE EXCEPTION 'Este estado não permite liberação manual; confira o fornecedor';
  END IF;
  IF v_job.external_order_id IS NULL OR trim(v_job.external_order_id)='' OR
     v_job.external_order_id IS DISTINCT FROM p_order_id THEN
    RAISE EXCEPTION 'Número do pedido cancelado não corresponde ao pedido registrado';
  END IF;
  IF v_job.client_id IS NULL THEN RAISE EXCEPTION 'Pedido sem cliente associado'; END IF;
  SELECT * INTO v_client FROM public.clients WHERE id=v_job.client_id FOR UPDATE;
  IF NOT FOUND OR v_client.login IS DISTINCT FROM v_job.login OR
     v_client.server IS DISTINCT FROM v_job.server OR
     v_client.due_date IS DISTINCT FROM v_job.expected_due_date THEN
    RAISE EXCEPTION 'Cadastro mudou, não é seguro liberar renovação manual';
  END IF;

  INSERT INTO public.external_renewal_cancellations
    (job_id,client_id,external_order_id,old_state,cancelled_by,evidence)
  VALUES (v_job.id,v_client.id,v_job.external_order_id,v_job.state,
    v_owner,trim(p_evidence));
  UPDATE public.external_renewal_jobs
  SET state='cancelled',updated_at=now(),
    external_message='Cancelamento informado pelo proprietário no Painel Recarga; somente operação manual, sem novo pedido externo.'
  WHERE id=v_job.id;
  RETURN jsonb_build_object('ok',true,'state','cancelled',
    'jobId',v_job.id,'orderId',v_job.external_order_id);
END
$function$;
REVOKE ALL ON FUNCTION public.record_panel_cancelled_for_manual(uuid,text,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_panel_cancelled_for_manual(uuid,text,text,text)
  TO authenticated;
