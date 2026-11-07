-- MaxFlix: Brazilian business-calendar dates for renewal settlements.
-- Fix the UTC-day boundary without changing technical/financial access expiry.
-- Function authorization and existing transactional guards remain unchanged.
DO $timezone_patch$
DECLARE
  v_func text;
  v_expected integer;
  v_definition text;
  v_occurrences integer;
BEGIN
  FOR v_func,v_expected IN
    SELECT * FROM (VALUES
      ('public.renew_client_with_credit(uuid,date,date,date,numeric,numeric,numeric,numeric,numeric)',4),
      ('public.sync_external_renewal_job(uuid)',3),
      ('public.sync_external_free_pilot_job(uuid)',2)
    ) AS required(function_signature, occurrences)
  LOOP
    SELECT pg_get_functiondef(to_regprocedure(v_func)) INTO v_definition;
    IF v_definition IS NULL THEN
      RAISE EXCEPTION 'Função ausente: %',v_func;
    END IF;
    v_occurrences:=(length(v_definition)-length(replace(v_definition,'CURRENT_DATE','')))/length('CURRENT_DATE');
    IF v_occurrences=0 AND position('America/Sao_Paulo' IN v_definition)>0 THEN
      CONTINUE;
    ELSIF v_occurrences<>v_expected THEN
      RAISE EXCEPTION 'Função % divergiu: % CURRENT_DATE (esperado %)',
        v_func,v_occurrences,v_expected;
    END IF;
    EXECUTE replace(v_definition,'CURRENT_DATE',
      '(now() AT TIME ZONE ''America/Sao_Paulo'')::date');
  END LOOP;
END
$timezone_patch$;

-- The Nov 6 pilots were created just after midnight UTC on Nov 7,
-- while it was still Nov 6 in Rio. Only these four exact known jobs
-- are corrected; manual payments belonging to other clients are untouched.
DO $correct_pilots$
DECLARE v_count integer;
BEGIN
  UPDATE public.payments
  SET paid_at='2026-11-06'::date
  WHERE id IN (
    'f94201af-21ac-4763-b4c5-c224b96de125'::uuid,
    '38e6aae7-dc43-432e-8002-1d449a81cf82'::uuid
  )
  AND paid_at='2026-11-07'::date
  AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date='2026-11-06'::date;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count NOT IN (0,2) THEN
    RAISE EXCEPTION 'Corrigir pagamentos: contagem inesperada %',v_count;
  END IF;
  UPDATE public.server_credit_movements
  SET occurred_on='2026-11-06'::date
  WHERE id IN (
    '67563f4b-9cf7-40a2-8e3f-aee26ec88ea8'::uuid,
    'cfff1050-b5f0-4038-aec2-5b92b7cd0e6f'::uuid,
    '3f5b085d-cb55-464e-80e4-bd1c1b2afa62'::uuid,
    '318635c4-9d04-47e5-900b-f046830aad93'::uuid
  )
  AND occurred_on='2026-11-07'::date
  AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date='2026-11-06'::date;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count NOT IN (0,4) THEN
    RAISE EXCEPTION 'Corrigir créditos: contagem inesperada %',v_count;
  END IF;
END
$correct_pilots$;
