-- Prepared for coordinated deployment only, NOT applied here.
-- Owner-only atomic reconciliation for a confirmed no-charge ACTIVE subscription.
CREATE OR REPLACE FUNCTION public.sync_external_zero_active_job(p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO ''
AS $function$
DECLARE
  v_owner CONSTANT uuid := 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e';
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_job public.external_renewal_jobs%ROWTYPE;
  v_client public.clients%ROWTYPE;
  v_values jsonb;
  v_cost numeric;
BEGIN
  IF (SELECT auth.uid()) IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'Conta não autorizada';
  END IF;
  SELECT * INTO v_job FROM public.external_renewal_jobs
    WHERE id=p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;
  IF v_job.state='synced' THEN
    RETURN jsonb_build_object('ok',true,'alreadyProcessed',true,
      'dueDate',v_job.new_due_date,'financialDueDate',v_job.financial_due_date,
      'orderId',v_job.external_order_id);
  END IF;
  IF v_job.state<>'external_confirmed' OR v_job.client_id IS NULL THEN
    RAISE EXCEPTION 'Pedido não confirmado pelo fornecedor';
  END IF;
  SELECT * INTO v_client FROM public.clients
    WHERE id=v_job.client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente não encontrado'; END IF;
  IF v_client.login IS DISTINCT FROM v_job.login OR
     v_client.server IS DISTINCT FROM v_job.server OR
     v_client.due_date IS DISTINCT FROM v_job.expected_due_date THEN
    RAISE EXCEPTION 'Cadastro ou vencimento alterado desde o pedido';
  END IF;
  v_cost:=CASE WHEN v_client.cost>0 THEN v_client.cost ELSE v_client.prev_cost END;
  IF v_client.server NOT IN ('Club','Five','Uniplay','UniP2P','Blade','Now','GF','Fast','All Play')
    OR v_client.access_type NOT IN ('padrao','gratuidade','meu_acesso')
    OR v_client.paid IS DISTINCT FROM 0
    OR v_client.due_date<v_today
    OR v_client.financial_due_date IS DISTINCT FROM v_client.due_date
    OR v_client.cost<0 OR v_client.prev_cost<0
    OR v_cost IS NULL OR v_cost<=0 THEN
    RAISE EXCEPTION 'Cliente não está ativo e sem cobrança com custo técnico conhecido';
  END IF;
  IF v_job.new_due_date<=v_client.due_date OR
     v_job.new_due_date<=v_today OR
     v_job.new_due_date>(v_client.due_date+interval '45 days')::date OR
     v_job.financial_due_date IS DISTINCT FROM v_job.new_due_date THEN
    RAISE EXCEPTION 'Próximo ciclo técnico incompatível com o fornecedor';
  END IF;
  v_values:=v_job.local_values;
  IF pg_catalog.jsonb_typeof(v_values)<>'object'
    OR v_values->>'pilotKind' IS DISTINCT FROM 'zero_active'
    OR v_values->>'months' IS DISTINCT FROM '1'
    OR v_values->>'dueDate' IS DISTINCT FROM v_job.new_due_date::text
    OR v_values->>'financialDueDate' IS DISTINCT FROM v_job.financial_due_date::text
    OR (v_values->>'cost')::numeric IS DISTINCT FROM v_cost
    OR (v_values->>'prevPaid')::numeric IS DISTINCT FROM v_client.prev_paid
    OR v_values->>'monthlyPaid' IS DISTINCT FROM '0'
    OR v_values->>'paymentAmount' IS DISTINCT FROM '0'
    OR v_values->>'paymentCost' IS DISTINCT FROM '0' THEN
    RAISE EXCEPTION 'Pedido sem cobrança não corresponde ao cadastro';
  END IF;
  UPDATE public.clients SET due_date=v_job.new_due_date,
    financial_due_date=v_job.financial_due_date,
    cost=v_cost,prev_cost=v_cost
    WHERE id=v_client.id;
  -- Preserves paid=0 and historical prev_paid. NO INSERT into payments.
  INSERT INTO public.server_credit_movements
    (server,kind,quantity,occurred_on,client_id,note)
  VALUES(v_client.server,'renewal',-1,v_today,v_client.id,
    'Painel Recarga (ativo sem cobrança): '||v_client.name||
    COALESCE(' • pedido '||v_job.external_order_id,''));
  UPDATE public.external_renewal_jobs
  SET state='synced',synced_at=now(),updated_at=now(),
      external_message='Ciclo técnico confirmado; sem pagamento novo.'
  WHERE id=v_job.id;
  RETURN jsonb_build_object('ok',true,'alreadyProcessed',false,
    'dueDate',v_job.new_due_date,'financialDueDate',v_job.financial_due_date,
    'orderId',v_job.external_order_id);
END
$function$;
REVOKE ALL ON FUNCTION public.sync_external_zero_active_job(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_external_zero_active_job(uuid) TO authenticated;
