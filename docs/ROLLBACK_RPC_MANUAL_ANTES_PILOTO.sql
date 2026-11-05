-- ROLLBACK MANUAL (NÃO executar automaticamente)
-- Versão do RPC renew_client_with_credit ANTERIOR à guarda de pedidos externos.
-- Aplique somente após desativar renovação real, confirmar que não existem
-- pedidos externos em andamento/conciliar e validar a necessidade.
-- Esta operação NÃO reverte pagamentos, vencimentos ou créditos já registrados.
-- O arquivo fica em docs/ (não é uma migration executada automaticamente).
CREATE OR REPLACE FUNCTION public.renew_client_with_credit(
 p_client_id uuid, p_expected_due_date date, p_due_date date,
 p_financial_due_date date, p_cost numeric,p_monthly_paid numeric,
 p_prev_paid numeric,p_payment_amount numeric DEFAULT 0,p_payment_cost numeric DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE v_client public.clients%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Acesso não autorizado'; END IF;
 SELECT * INTO v_client FROM public.clients WHERE id=p_client_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cliente não encontrado'; END IF;
 IF v_client.due_date <> p_expected_due_date THEN
   RAISE EXCEPTION 'Este cliente já foi renovado. Atualize a página.';
 END IF;
 IF p_due_date <= v_client.due_date AND v_client.due_date >= CURRENT_DATE
   THEN RAISE EXCEPTION 'Novo vencimento inválido'; END IF;
 IF p_due_date <= CURRENT_DATE OR p_financial_due_date < p_due_date
   THEN RAISE EXCEPTION 'Datas de renovação inválidas'; END IF;
 IF p_cost < 0 OR p_monthly_paid < 0 OR p_prev_paid < 0
   OR p_payment_amount < 0 OR p_payment_cost < 0
   THEN RAISE EXCEPTION 'Valores inválidos'; END IF;
 UPDATE public.clients
 SET due_date=p_due_date,financial_due_date=p_financial_due_date,
     cost=p_cost,paid=p_monthly_paid,prev_cost=p_cost,prev_paid=p_prev_paid
 WHERE id=p_client_id;
 IF p_payment_amount>0 THEN
   INSERT INTO public.payments(client_id,client_name,server,amount,cost,paid_at)
   VALUES(v_client.id,v_client.name,v_client.server,
     p_payment_amount,p_payment_cost,CURRENT_DATE);
 END IF;
 INSERT INTO public.server_credit_movements
   (server,kind,quantity,occurred_on,client_id,note)
 VALUES(v_client.server,'renewal',-1,CURRENT_DATE,v_client.id,v_client.name);
END;
$function$;
