-- One-date owner reconciliation for a provider-confirmed order whose PREVIOUS
-- expiry did not match MaxFlix. A manual date is the observed provider expiry.
-- No new external order is sent, and the existing atomic settlement is reused.
-- Monthly: technical AND financial due dates follow the entered provider date,
-- because the existing MaxFlix billing/renewal model requires them to match.
-- Prepaid: keep existing paid financial coverage; reject any date beyond it.
CREATE OR REPLACE FUNCTION public.reconcile_external_provider_date_job(
  p_job_id uuid,
  p_panel_due date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  v_owner CONSTANT uuid := 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e';
  v_job public.external_renewal_jobs%ROWTYPE;
  v_client public.clients%ROWTYPE;
  v_values jsonb;
  v_financial_due date;
  v_date_ceiling date;
  v_business_date date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_result jsonb;
BEGIN
  IF (SELECT auth.uid()) IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'Somente o proprietário pode conciliar pedidos externos';
  END IF;

  SELECT * INTO v_job
  FROM public.external_renewal_jobs
  WHERE id = p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido externo não encontrado'; END IF;

  IF v_job.state = 'synced' THEN
    IF p_panel_due IS DISTINCT FROM v_job.new_due_date THEN
      RAISE EXCEPTION 'Pedido já sincronizado com outra data; confira o cadastro';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'ok',true,'alreadyProcessed',true,
      'orderId',v_job.external_order_id,
      'dueDate',v_job.new_due_date,
      'financialDueDate',v_job.financial_due_date);
  END IF;

  -- An HTTP 200 by itself is not enough. Only the specific provider-confirmed
  -- previous-expiry mismatch, with a known original order, is eligible.
  IF v_job.state <> 'needs_review'
    OR v_job.external_http_status IS DISTINCT FROM 200
    OR v_job.external_order_id IS NULL
    OR v_job.external_message IS DISTINCT FROM
      'O vencimento anterior informado pelo painel difere da MaxFlix. Revise antes de atualizar.'
    OR v_job.provider_request_token IS NOT NULL
    OR v_job.client_id IS NULL THEN
    RAISE EXCEPTION 'Pedido não elegível para conciliação por data';
  END IF;

  SELECT * INTO v_client
  FROM public.clients
  WHERE id = v_job.client_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_client.login IS DISTINCT FROM v_job.login
    OR v_client.server IS DISTINCT FROM v_job.server
    OR v_client.due_date IS DISTINCT FROM v_job.expected_due_date
    OR v_client.financial_due_date IS NULL
    OR v_client.financial_due_date < v_client.due_date THEN
    RAISE EXCEPTION 'Cadastro ou vencimento alterado: revise sem reenviar pedido';
  END IF;

  -- Only a plausible future one-cycle date may be approved. The old maximum
  -- 45-day technical-window safeguard remains enforced independently.
  v_date_ceiling := greatest(v_client.due_date,v_business_date) + 45;
  IF p_panel_due IS NULL OR p_panel_due <= v_business_date
    OR p_panel_due <= v_client.due_date
    OR p_panel_due > v_date_ceiling THEN
    RAISE EXCEPTION 'Data informada fora do período válido de um ciclo';
  END IF;

  v_values := v_job.local_values;
  IF pg_catalog.jsonb_typeof(v_values) IS DISTINCT FROM 'object'
    OR v_values ? 'pilotKind'
    OR v_values->>'months' IS DISTINCT FROM '1'
    OR v_values->>'dueDate' IS DISTINCT FROM v_job.new_due_date::text
    OR v_values->>'financialDueDate' IS DISTINCT FROM v_job.financial_due_date::text THEN
    RAISE EXCEPTION 'Tipo ou valores do pedido exigem conciliação específica';
  END IF;

  IF v_client.financial_due_date > v_client.due_date THEN
    -- Packages: an already-paid technical cycle, no further cash collection.
    IF p_panel_due > v_client.financial_due_date
      OR (v_values->>'paymentAmount')::numeric <> 0
      OR (v_values->>'paymentCost')::numeric <> 0
      OR (v_values->>'monthlyPaid')::numeric <> 0 THEN
      RAISE EXCEPTION 'Data técnica ultrapassa cobertura financeira já paga';
    END IF;
    v_financial_due := v_client.financial_due_date;
  ELSE
    -- Monthly: MaxFlix currently treats technical due as billing due.
    -- Keep both aligned instead of creating an invalid financial<technical
    -- state, while the date approved here is the provider date.
    IF (v_values->>'paymentAmount')::numeric <= 0
      OR (v_values->>'monthlyPaid')::numeric <= 0 THEN
      RAISE EXCEPTION 'Recebimento mensal do pedido não confirmado';
    END IF;
    v_financial_due := p_panel_due;

    -- Avoid a duplicate receipt when a client was settled manually.
    IF EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.client_id=v_client.id
        AND p.paid_at >= greatest(
          v_client.due_date-7,
          (v_job.created_at AT TIME ZONE 'America/Sao_Paulo')::date-7
        )
        AND p.paid_at <= v_business_date
    ) THEN
      RAISE EXCEPTION 'Já existe pagamento recente: concilie separadamente';
    END IF;
  END IF;

  -- The original provider order is already executed. Store who accepted the
  -- date and the previous plan; never call the provider or reserve a new job.
  UPDATE public.external_renewal_jobs
  SET state='external_confirmed',
      new_due_date=p_panel_due,
      financial_due_date=v_financial_due,
      local_values=v_values
        || pg_catalog.jsonb_build_object(
          'dueDate',p_panel_due::text,
          'financialDueDate',v_financial_due::text,
          'manualReview',pg_catalog.jsonb_build_object(
            'reason','confirmed_provider_previous_due_mismatch',
            'acceptedAt',pg_catalog.now()::text,
            'acceptedBy',(SELECT auth.uid())::text,
            'originalPlannedDue',v_job.new_due_date::text,
            'providerDue',p_panel_due::text,
            'originalOrderId',v_job.external_order_id
          )
        ),
      updated_at=pg_catalog.now()
  WHERE id=v_job.id;

  -- ONE transaction: lock, cash movement, one local credit and synced state;
  -- any failure rolls back the review and all updates automatically.
  v_result := public.sync_external_renewal_job(p_job_id);
  RETURN v_result;
END
$function$;

REVOKE ALL ON FUNCTION public.reconcile_external_provider_date_job(uuid,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_external_provider_date_job(uuid,date) FROM anon;
GRANT EXECUTE ON FUNCTION public.reconcile_external_provider_date_job(uuid,date) TO authenticated;
