-- MaxFlix: isolated free-access pilot settlement.
-- Paid renewal RPC remains unchanged. This function only reconciles an
-- ALREADY confirmed provider job for one of the two explicitly selected
-- zero-revenue trial accesses, and never writes to public.payments.
CREATE OR REPLACE FUNCTION public.sync_external_free_pilot_job(p_job_id uuid)
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
BEGIN
  IF (SELECT auth.uid()) IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'Conta não autorizada a sincronizar piloto gratuito';
  END IF;

  SELECT * INTO v_job FROM public.external_renewal_jobs
  WHERE id=p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido externo não encontrado'; END IF;
  IF v_job.state='synced' THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok',true,'alreadyProcessed',true,
      'dueDate',v_job.new_due_date,
      'financialDueDate',v_job.financial_due_date,
      'orderId',v_job.external_order_id
    );
  END IF;
  IF v_job.state<>'external_confirmed' OR v_job.client_id IS NULL THEN
    RAISE EXCEPTION 'Pedido gratuito sem confirmação externa';
  END IF;

  -- Pilot scope intentionally narrow until independently audited.
  IF NOT (
    (v_job.client_id='722594de-3ace-42e8-a051-bf446e94a548'::uuid AND v_job.server='Blade')
    OR
    (v_job.client_id='3b6db387-50cc-49eb-94a9-3d3dba1790e0'::uuid AND v_job.server='Now')
  ) THEN
    RAISE EXCEPTION 'Piloto gratuito não autorizado para este cliente';
  END IF;

  SELECT * INTO v_client FROM public.clients
  WHERE id=v_job.client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente não encontrado'; END IF;
  IF v_client.login<>v_job.login OR v_client.server<>v_job.server OR
     v_client.due_date<>v_job.expected_due_date THEN
    RAISE EXCEPTION 'Cadastro alterado desde a autorização. Concilie antes de atualizar.';
  END IF;
  IF v_client.paid<>0 OR v_client.prev_paid<>0 OR
     v_client.access_type NOT IN ('padrao','meu_acesso') OR
     v_client.financial_due_date IS NULL OR
     v_client.financial_due_date<>v_client.due_date THEN
    RAISE EXCEPTION 'Acesso deixou de atender às regras do piloto gratuito';
  END IF;
  IF v_job.new_due_date<=v_client.due_date OR
     v_job.new_due_date<=CURRENT_DATE OR
     v_job.financial_due_date<>v_job.new_due_date THEN
    RAISE EXCEPTION 'Vencimentos gratuitos confirmados inconsistentes';
  END IF;

  v_values:=v_job.local_values;
  IF pg_catalog.jsonb_typeof(v_values)<>'object' OR
     v_values->>'pilotKind' IS DISTINCT FROM 'unpaid' OR
     v_values->>'months' IS DISTINCT FROM '1' OR
     v_values->>'dueDate' IS DISTINCT FROM v_job.new_due_date::text OR
     v_values->>'financialDueDate' IS DISTINCT FROM v_job.financial_due_date::text OR
     v_values->>'paymentAmount' IS DISTINCT FROM '0' OR
     v_values->>'paymentCost' IS DISTINCT FROM '0' OR
     v_values->>'monthlyPaid' IS DISTINCT FROM '0' OR
     v_values->>'prevPaid' IS DISTINCT FROM '0' OR
     (v_values->>'cost')::numeric IS DISTINCT FROM v_client.cost THEN
    RAISE EXCEPTION 'Pedido gratuito possui valores financeiros inválidos';
  END IF;

  UPDATE public.clients
  SET due_date=v_job.new_due_date,
      financial_due_date=v_job.financial_due_date
  WHERE id=v_client.id;

  -- No INSERT into payments: the user confirmed this is a free access.
  INSERT INTO public.server_credit_movements
    (server,kind,quantity,occurred_on,client_id,note)
  VALUES (v_client.server,'renewal',-1,CURRENT_DATE,
    v_client.id,'Painel Recarga (piloto gratuito): '||v_client.name||
    COALESCE(' • pedido '||v_job.external_order_id,''));

  UPDATE public.external_renewal_jobs
  SET state='synced',synced_at=pg_catalog.now(),
      updated_at=pg_catalog.now(),
      external_message='Piloto gratuito confirmado; datas e crédito sincronizados sem pagamento.'
  WHERE id=v_job.id;

  RETURN pg_catalog.jsonb_build_object(
    'ok',true,'alreadyProcessed',false,
    'dueDate',v_job.new_due_date,
    'financialDueDate',v_job.financial_due_date,
    'orderId',v_job.external_order_id
  );
END
$function$;

REVOKE ALL ON FUNCTION public.sync_external_free_pilot_job(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_external_free_pilot_job(uuid) TO authenticated;
