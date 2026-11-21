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
    OR v_client.financial_due_date IS NULL
    OR v_client.financial_due_date < v_client.due_date THEN
    RAISE EXCEPTION 'Cadastro ou vencimento alterado: revise sem reenviar pedido';
  END IF;

  -- Only a plausible future one-cycle date may be approved. The old maximum
  -- 45-day technical-window safeguard remains enforced independently.
  v_date_ceiling := greatest(v_job.expected_due_date,v_business_date) + 45;
  IF p_panel_due IS NULL OR p_panel_due <= v_business_date
    OR p_panel_due <= v_job.expected_due_date
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

  -- These two states are supported:
  -- (A) Client still has its old due date: use existing atomic settlement.
  -- (B) Owner already edited the client with the provider date, but the
  -- original provider order remained in needs_review with NO local ledger.
  -- In (B), settle ONLY the missing cash/credit and keep the edited date.
  IF v_client.due_date IS DISTINCT FROM v_job.expected_due_date THEN
    IF v_client.access_type <> 'padrao'
      OR v_client.due_date IS DISTINCT FROM p_panel_due
      OR v_client.financial_due_date IS DISTINCT FROM p_panel_due
      OR (v_values->>'paymentAmount')::numeric <= 0
      OR v_client.paid IS DISTINCT FROM (v_values->>'monthlyPaid')::numeric
      OR v_client.cost IS DISTINCT FROM (v_values->>'cost')::numeric
      OR v_client.prev_cost IS DISTINCT FROM (v_values->>'cost')::numeric
      OR v_client.prev_paid IS DISTINCT FROM (v_values->>'prevPaid')::numeric THEN
      RAISE EXCEPTION 'Cadastro já alterado com dados divergentes: revisão necessária';
    END IF;

    -- Block duplicate financial or credit entries before any local journal.
    IF EXISTS(
      SELECT 1 FROM public.server_credit_movements m
      WHERE m.client_id=v_client.id AND m.server=v_client.server
        AND m.kind='renewal'
        AND m.occurred_on >= (v_job.created_at AT TIME ZONE 'America/Sao_Paulo')::date-7
    ) THEN
      RAISE EXCEPTION 'Crédito desta renovação pode já ter sido lançado';
    END IF;

    -- The existing payment check above blocks any receipt in the same window.
    -- There is no client date update here: it already equals the provider date.
    INSERT INTO public.payments(client_id,client_name,server,amount,cost,paid_at)
    VALUES (
      v_client.id,v_client.name,v_client.server,
      (v_values->>'paymentAmount')::numeric,
      (v_values->>'paymentCost')::numeric,
      v_business_date
    );

    INSERT INTO public.server_credit_movements
      (server,kind,quantity,occurred_on,client_id,note)
    VALUES (
      v_client.server,'renewal',-1,v_business_date,v_client.id,
      'Painel Recarga: '||v_client.name||
      ' • pedido '||v_job.external_order_id||' (conciliação de data)'
    );

    UPDATE public.external_renewal_jobs
    SET state='synced',new_due_date=p_panel_due,
        financial_due_date=p_panel_due,synced_at=pg_catalog.now(),
        local_values=v_values || pg_catalog.jsonb_build_object(
          'dueDate',p_panel_due::text,
          'financialDueDate',p_panel_due::text,
          'manualReview',pg_catalog.jsonb_build_object(
            'reason','already_advanced_by_owner_provider_date',
            'acceptedAt',pg_catalog.now()::text,
            'acceptedBy',(SELECT auth.uid())::text,
            'originalPlannedDue',v_job.new_due_date::text,
            'providerDue',p_panel_due::text,
            'originalOrderId',v_job.external_order_id
          )
        ),
        external_message='Pedido externo conferido; crédito e pagamento conciliados sem nova renovação.',
        updated_at=pg_catalog.now()
    WHERE id=v_job.id;
    RETURN pg_catalog.jsonb_build_object(
      'ok',true,'alreadyProcessed',false,
      'dueDate',p_panel_due,'financialDueDate',p_panel_due,
      'orderId',v_job.external_order_id
    );
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
