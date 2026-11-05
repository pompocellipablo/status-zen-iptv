-- MaxFlix + Painel Recarga: atomic, idempotent local settlement of an
-- ALREADY confirmed external renewal. No external network operations here.
-- The Edge Function verifies exact provider login and confirmed dates first.
-- This RPC replaces the two separate statements (renew_client_with_credit +
-- update external_renewal_jobs.state) with ONE database transaction.
CREATE OR REPLACE FUNCTION public.sync_external_renewal_job(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  v_owner CONSTANT uuid := 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e';
  v_job public.external_renewal_jobs%ROWTYPE;
  v_client public.clients%ROWTYPE;
  v_values jsonb;
  v_months integer;
  v_cost numeric;
  v_monthly_paid numeric;
  v_prev_paid numeric;
  v_payment_amount numeric;
  v_payment_cost numeric;
BEGIN
  IF (SELECT auth.uid()) IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'Conta não autorizada a sincronizar renovação externa';
  END IF;

  -- Lock first: concurrent checks for the same job serialize here.
  SELECT * INTO v_job
  FROM public.external_renewal_jobs
  WHERE id = p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido externo não encontrado';
  END IF;
  IF v_job.state = 'synced' THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok',true,'alreadyProcessed',true,'dueDate',v_job.new_due_date,
      'financialDueDate',v_job.financial_due_date,'orderId',v_job.external_order_id
    );
  END IF;
  IF v_job.state <> 'external_confirmed' THEN
    RAISE EXCEPTION 'Pedido externo ainda não foi confirmado para sincronização';
  END IF;
  IF v_job.client_id IS NULL THEN
    RAISE EXCEPTION 'Pedido externo não possui cliente vinculado';
  END IF;

  SELECT * INTO v_client FROM public.clients WHERE id = v_job.client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente externo não encontrado'; END IF;
  IF v_client.due_date <> v_job.expected_due_date THEN
    RAISE EXCEPTION 'Vencimento do cliente mudou; conciliação manual necessária';
  END IF;
  IF v_client.login <> v_job.login OR v_client.server <> v_job.server THEN
    RAISE EXCEPTION 'Login ou servidor alterado; conciliação manual necessária';
  END IF;
  IF v_client.financial_due_date IS NULL OR
    v_client.financial_due_date < v_client.due_date THEN
    RAISE EXCEPTION 'Cobertura financeira inconsistente; revise antes de sincronizar';
  END IF;
  IF v_job.new_due_date <= v_client.due_date OR
     v_job.new_due_date <= CURRENT_DATE OR
     v_job.financial_due_date < v_job.new_due_date THEN
    RAISE EXCEPTION 'Vencimento confirmado inválido para lançamento';
  END IF;

  v_values := v_job.local_values;
  IF pg_catalog.jsonb_typeof(v_values) <> 'object'
    OR (v_values->>'dueDate') IS DISTINCT FROM v_job.new_due_date::text
    OR (v_values->>'financialDueDate') IS DISTINCT FROM v_job.financial_due_date::text THEN
    RAISE EXCEPTION 'Plano confirmado difere do registro de pagamento';
  END IF;
  v_months := (v_values->>'months')::integer;
  v_cost := (v_values->>'cost')::numeric;
  v_monthly_paid := (v_values->>'monthlyPaid')::numeric;
  v_prev_paid := (v_values->>'prevPaid')::numeric;
  v_payment_amount := (v_values->>'paymentAmount')::numeric;
  v_payment_cost := (v_values->>'paymentCost')::numeric;
  IF v_months IS NULL OR v_months < 1 OR v_months > 120 OR
     v_cost IS NULL OR v_cost < 0 OR v_monthly_paid IS NULL OR v_monthly_paid < 0 OR
     v_prev_paid IS NULL OR v_prev_paid < 0 OR
     v_payment_amount IS NULL OR v_payment_amount < 0 OR
     v_payment_cost IS NULL OR v_payment_cost < 0 THEN
    RAISE EXCEPTION 'Valores do pedido externo inválidos';
  END IF;

  IF v_client.financial_due_date > v_client.due_date THEN
    -- PREPAID: one provider cycle, NO additional payment, NO financial shift.
    IF v_job.financial_due_date <> v_client.financial_due_date
      OR v_months <> 1 OR v_payment_amount <> 0
      OR v_payment_cost <> 0 OR v_monthly_paid <> 0 THEN
      RAISE EXCEPTION 'Pacote já pago não pode gerar nova cobrança';
    END IF;
  ELSE
    -- NEW CONTRACT / RENEWAL: payment is required; monthly equals technical.
    IF v_payment_amount <= 0 THEN
      RAISE EXCEPTION 'Novo período financeiro sem pagamento confirmado';
    END IF;
    IF (v_months = 1 AND v_job.financial_due_date <> v_job.new_due_date)
      OR (v_months > 1 AND v_job.financial_due_date <= v_job.new_due_date) THEN
      RAISE EXCEPTION 'Vencimento financeiro incompatível com o plano contratado';
    END IF;
  END IF;

  UPDATE public.clients
  SET due_date=v_job.new_due_date, financial_due_date=v_job.financial_due_date,
      cost=v_cost, paid=v_monthly_paid, prev_cost=v_cost, prev_paid=v_prev_paid
  WHERE id=v_client.id;

  IF v_payment_amount > 0 THEN
    INSERT INTO public.payments(client_id,client_name,server,amount,cost,paid_at)
    VALUES (v_client.id,v_client.name,v_client.server,
      v_payment_amount,v_payment_cost,CURRENT_DATE);
  END IF;

  INSERT INTO public.server_credit_movements
    (server,kind,quantity,occurred_on,client_id,note)
  VALUES
    (v_client.server,'renewal',-1,CURRENT_DATE,
      v_client.id,'Painel Recarga: '||v_client.name||
      COALESCE(' • pedido '||v_job.external_order_id,''));

  UPDATE public.external_renewal_jobs
  SET state='synced',synced_at=pg_catalog.now(),updated_at=pg_catalog.now(),
      external_message='Renovação externa confirmada e sincronizada em transação única.'
  WHERE id=v_job.id;

  RETURN pg_catalog.jsonb_build_object(
    'ok',true,'alreadyProcessed',false,'dueDate',v_job.new_due_date,
    'financialDueDate',v_job.financial_due_date,'orderId',v_job.external_order_id
  );
END
$function$;

-- Functions default to EXECUTE for PUBLIC on new migrations; explicitly
-- exclude anonymous access and require both authenticated role + owner check.
REVOKE EXECUTE ON FUNCTION public.sync_external_renewal_job(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_external_renewal_job(uuid) TO authenticated;
