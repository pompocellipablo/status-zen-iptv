CREATE TABLE public.client_initial_registrations (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  request jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.client_initial_registrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_initial_registrations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.client_initial_registrations TO authenticated;
CREATE POLICY initial_registration_read ON public.client_initial_registrations
  FOR SELECT TO authenticated USING (actor_id = (SELECT auth.uid()));
CREATE POLICY initial_registration_insert ON public.client_initial_registrations
  FOR INSERT TO authenticated WITH CHECK (actor_id = (SELECT auth.uid()));

CREATE FUNCTION public.register_client_with_payment(p_request_id uuid, p_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_existing public.client_initial_registrations%ROWTYPE;
  v_client_id uuid;
  v_months integer := (p_data->>'months')::integer;
  v_start date := (p_data->>'starts_on')::date;
  v_paid_on date := (p_data->>'paid_on')::date;
  v_due date := (p_data->>'due_date')::date;
  v_end date;
  v_amount numeric := (p_data->>'amount')::numeric;
  v_cost numeric := (p_data->>'cost')::numeric;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_name text := btrim(p_data->>'name');
  v_login text := btrim(p_data->>'login');
  v_server text := p_data->>'server';
BEGIN
  IF v_actor IS NULL OR p_request_id IS NULL OR p_data IS NULL THEN
    RAISE EXCEPTION 'Acesso ou solicitação inválida';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  SELECT * INTO v_existing FROM public.client_initial_registrations WHERE id=p_request_id;
  IF FOUND THEN
    IF v_existing.actor_id<>v_actor OR v_existing.request IS DISTINCT FROM p_data THEN
      RAISE EXCEPTION 'Solicitação já utilizada com outros dados. Confira o cliente salvo antes de continuar.';
    END IF;
    IF v_existing.client_id IS NULL THEN RAISE EXCEPTION 'Cadastro anterior excluído; confira o histórico.'; END IF;
    RETURN v_existing.client_id;
  END IF;
  IF v_months IS NULL OR v_months NOT IN (1,6,12)
    OR v_start IS NULL OR v_start>v_today OR v_paid_on IS NULL OR v_paid_on>v_today
    OR v_amount IS NULL OR NOT (v_amount>0 AND v_amount<=99999999.99)
    OR v_cost IS NULL OR NOT (v_cost>=0 AND v_cost<=99999999.99)
    OR round(v_amount,2)<>v_amount OR round(v_cost,2)<>v_cost
    OR (p_data->>'payment_confirmed')::boolean IS DISTINCT FROM true
    OR (p_data->>'activation_confirmed')::boolean IS DISTINCT FROM true
    OR (p_data->>'debit_credit')::boolean IS NULL THEN
    RAISE EXCEPTION 'Plano, valores, datas ou confirmações inválidos';
  END IF;
  v_end := (v_start + make_interval(months => v_months))::date;
  IF v_due IS NULL OR v_due<=v_start OR v_due>v_end OR v_due<v_today THEN
    RAISE EXCEPTION 'Vencimento técnico fora da cobertura do plano';
  END IF;
  IF coalesce(length(v_name),0) NOT BETWEEN 1 AND 120
    OR coalesce(length(v_login),0) NOT BETWEEN 1 AND 120
    OR v_server IS NULL OR v_server NOT IN ('Elite','Now','Five','Uniplay','UniP2P','Fast','All Play','GF','Blade','Club')
    OR length(coalesce(p_data->>'notes',''))>3000
    OR length(coalesce(p_data->>'whatsapp',''))>30 THEN
    RAISE EXCEPTION 'Dados do cliente inválidos';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(lower(v_server)||':'||lower(v_login), 0));
  IF EXISTS(SELECT 1 FROM public.clients WHERE server=v_server AND lower(btrim(login))=lower(v_login)) THEN
    RAISE EXCEPTION 'Este login já está cadastrado neste servidor. Confira o cadastro existente.';
  END IF;
  INSERT INTO public.clients(name,login,server,cost,paid,due_date,financial_due_date,
    prev_cost,prev_paid,access_type,whatsapp,notes,referred_by_client_id,referral_first_payment_confirmed)
  VALUES(v_name,v_login,v_server,v_cost,CASE WHEN v_months=1 THEN v_amount ELSE 0 END,
    v_due,v_end,v_cost,CASE WHEN v_months=1 THEN v_amount ELSE 0 END,
    CASE WHEN v_months=1 THEN 'padrao' ELSE 'pacote_pago' END,
    nullif(btrim(p_data->>'whatsapp'),''),
    concat_ws(E'\n',nullif(btrim(p_data->>'notes'),''),
      format('Cadastro: %s meses; recebido R$ %s em %s; cobertura %s a %s.',v_months,v_amount,v_paid_on,v_start,v_end)),
    nullif(p_data->>'referred_by_client_id','')::uuid,
    false)
  RETURNING id INTO v_client_id;
  INSERT INTO public.payments(client_id,client_name,server,amount,cost,paid_at)
    VALUES(v_client_id,v_name,v_server,v_amount,v_cost*v_months,v_paid_on);
  -- Keep existing package accounting: reserve the period's cost once, but
  -- debit only the actually used initial technical credit when explicitly selected.
  IF (p_data->>'debit_credit')::boolean THEN
    INSERT INTO public.server_credit_movements(server,kind,quantity,occurred_on,client_id,note)
      VALUES(v_server,'renewal',-1,v_start,v_client_id,'Ativação inicial confirmada — '||v_name);
  END IF;
  IF nullif(p_data->>'referred_by_client_id','') IS NOT NULL
    AND (p_data->>'referral_first_payment_confirmed')::boolean IS TRUE THEN
    UPDATE public.clients SET referral_first_payment_confirmed=true WHERE id=v_client_id;
  END IF;
  INSERT INTO public.client_initial_registrations(id,actor_id,client_id,request)
    VALUES(p_request_id,v_actor,v_client_id,p_data);
  RETURN v_client_id;
END;
$$;
REVOKE ALL ON FUNCTION public.register_client_with_payment(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_client_with_payment(uuid,jsonb) TO authenticated;