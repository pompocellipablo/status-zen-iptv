-- MaxFlix: manual reconciliation ONLY for a confirmed provider renewal whose
-- PREVIOUS expiry differed from MaxFlix. Does not send another provider order.
-- This is deliberately a separate owner-only RPC: ordinary renewal flow stays unchanged.
CREATE OR REPLACE FUNCTION public.reconcile_external_previous_due_job(
  p_job_id uuid,
  p_order_id text,
  p_panel_due date,
  p_evidence text,
  p_confirmation text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  v_owner CONSTANT uuid := 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e';
  v_job public.external_renewal_jobs%ROWTYPE;
  v_client public.clients%ROWTYPE;
  v_result jsonb;
  v_business_date date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF (SELECT auth.uid()) IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'Somente o proprietário pode conciliar pedidos externos';
  END IF;
  IF p_confirmation IS DISTINCT FROM 'CONFERIDO' OR
     p_order_id IS NULL OR length(trim(p_order_id)) < 4 OR length(p_order_id) > 120 OR
     p_panel_due IS NULL OR
     p_evidence IS NULL OR length(trim(p_evidence)) < 20 OR length(p_evidence) > 500 THEN
    RAISE EXCEPTION 'Confirmação, pedido, data e evidência são obrigatórios';
  END IF;

  SELECT * INTO v_job FROM public.external_renewal_jobs WHERE id=p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido externo não encontrado'; END IF;
  IF v_job.state='synced' THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok',true,'alreadyProcessed',true,'orderId',v_job.external_order_id,
      'dueDate',v_job.new_due_date,'financialDueDate',v_job.financial_due_date);
  END IF;
  IF v_job.state <> 'needs_review' OR
     v_job.external_http_status IS DISTINCT FROM 200 OR
     v_job.external_order_id IS NULL OR
     v_job.external_order_id IS DISTINCT FROM trim(p_order_id) OR
     v_job.external_message IS DISTINCT FROM
       'O vencimento anterior informado pelo painel difere da MaxFlix. Revise antes de atualizar.' OR
     v_job.provider_request_token IS NOT NULL THEN
    RAISE EXCEPTION 'Pedido não está elegível para conciliação do vencimento anterior';
  END IF;
  IF v_job.client_id IS NULL THEN
    RAISE EXCEPTION 'Pedido sem cliente: conciliação manual externa necessária';
  END IF;
  SELECT * INTO v_client FROM public.clients WHERE id=v_job.client_id FOR UPDATE;
  IF NOT FOUND OR
     v_client.login IS DISTINCT FROM v_job.login OR
     v_client.server IS DISTINCT FROM v_job.server OR
     v_client.due_date IS DISTINCT FROM v_job.expected_due_date THEN
    RAISE EXCEPTION 'Cadastro, login, servidor ou vencimento alterado: interrompa e revise';
  END IF;

  -- Owner has inspected the ORIGINAL order in the provider; never replace
  -- financial dates with a different provider expiry. This shortcut is only
  -- for a PREVIOUS-expiry discrepancy, with the expected NEW date verified.
  IF p_panel_due IS DISTINCT FROM v_job.new_due_date OR
     v_job.financial_due_date < p_panel_due OR
     p_panel_due <= v_business_date OR
     v_job.local_values->>'dueDate' IS DISTINCT FROM p_panel_due::text OR
     v_job.local_values->>'financialDueDate' IS DISTINCT FROM v_job.financial_due_date::text THEN
    RAISE EXCEPTION 'Data do painel diverge da cobrança: conciliação financeira separada necessária';
  END IF;

  -- Never register the same financial receipt again if a payment was already
  -- manually posted during the provider review. Conservative by design.
  IF (v_job.local_values->>'paymentAmount')::numeric > 0 AND EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.client_id=v_client.id
      AND p.paid_at >= (v_job.created_at AT TIME ZONE 'America/Sao_Paulo')::date - 15
      AND p.paid_at <= v_business_date
  ) THEN
    RAISE EXCEPTION 'Já existe pagamento neste período: revise antes de conciliar';
  END IF;

  -- Preserve evidence on the existing job, so an ordinary synced status can
  -- replace its message without erasing the owner's approval.
  UPDATE public.external_renewal_jobs
  SET state='external_confirmed',
      local_values=local_values || pg_catalog.jsonb_build_object(
        'manualReview',pg_catalog.jsonb_build_object(
          'confirmedAt',pg_catalog.now()::text,
          'providerDue',p_panel_due::text,
          'orderId',trim(p_order_id),
          'evidence',trim(p_evidence),
          'reason','provider_previous_due_mismatch'
        )
      ),
      updated_at=pg_catalog.now()
  WHERE id=v_job.id;
  -- The EXISTING settlement performs the financial, client and credit update
  -- atomically, with its own row locks and idempotency; never call provider.
  v_result := public.sync_external_renewal_job(p_job_id);
  RETURN v_result;
END
$function$;
REVOKE ALL ON FUNCTION public.reconcile_external_previous_due_job(uuid,text,date,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_external_previous_due_job(uuid,text,date,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reconcile_external_previous_due_job(uuid,text,date,text,text) TO authenticated;
