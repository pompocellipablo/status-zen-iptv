-- MaxFlix: one-time, idempotent correction of four already-settled manual renewals.
-- All four were recorded just after midnight UTC, while the business date
-- in America/Sao_Paulo was still the previous day. Do not change money,
-- quantity, access expiry, creation timestamps, or provider job records.
-- Requires exact known IDs; unknown/mixed states fail without any update.
DO $fix_four_manual_dates$
DECLARE
  v_pay_count integer;
  v_move_count integer;
BEGIN
  SELECT COUNT(*) INTO v_pay_count
  FROM public.payments
  WHERE id IN (
    'e29e2424-e8cf-47af-a0ea-59adac47c122'::uuid, -- JoaoPeixinho
    'ecddd6bf-cbbd-4cfa-918b-9713a584d0a0'::uuid, -- ThiagoViana
    'f420bc24-2d34-408c-bf50-39c4310234d2'::uuid, -- Fabiane Dantas
    '69c18111-26a0-4a0d-a9f2-c1dec911bacd'::uuid  -- LealPaulo2
  )
  AND paid_at=(created_at AT TIME ZONE 'UTC')::date
  AND paid_at=(created_at AT TIME ZONE 'America/Sao_Paulo')::date + 1
  AND amount>0 AND cost>=0;
  SELECT COUNT(*) INTO v_move_count
  FROM public.server_credit_movements
  WHERE id IN (
    '97c22ce2-53bb-44b7-a18c-f8b6b8096eee'::uuid, -- JoaoPeixinho
    '23569834-248a-4fbc-8e12-c5b338c291fa'::uuid, -- ThiagoViana
    '2f7207f5-7207-47a1-8d2e-df485179cdca'::uuid, -- Fabiane Dantas
    '02482056-f3c1-4c75-8583-e99c66a72baf'::uuid  -- LealPaulo2
  )
  AND occurred_on=(created_at AT TIME ZONE 'UTC')::date
  AND occurred_on=(created_at AT TIME ZONE 'America/Sao_Paulo')::date + 1
  AND kind='renewal' AND quantity=-1;

  IF v_pay_count=0 AND v_move_count=0 THEN
    RETURN; -- Safe to reapply after a successful run.
  END IF;
  IF v_pay_count<>4 OR v_move_count<>4 THEN
    RAISE EXCEPTION 'Manual date correction not applied: expected 4 payments and 4 credit movements, found % and %',
      v_pay_count,v_move_count;
  END IF;

  UPDATE public.payments SET paid_at=(created_at AT TIME ZONE 'America/Sao_Paulo')::date
  WHERE id IN (
    'e29e2424-e8cf-47af-a0ea-59adac47c122'::uuid,
    'ecddd6bf-cbbd-4cfa-918b-9713a584d0a0'::uuid,
    'f420bc24-2d34-408c-bf50-39c4310234d2'::uuid,
    '69c18111-26a0-4a0d-a9f2-c1dec911bacd'::uuid
  );
  UPDATE public.server_credit_movements
  SET occurred_on=(created_at AT TIME ZONE 'America/Sao_Paulo')::date
  WHERE id IN (
    '97c22ce2-53bb-44b7-a18c-f8b6b8096eee'::uuid,
    '23569834-248a-4fbc-8e12-c5b338c291fa'::uuid,
    '2f7207f5-7207-47a1-8d2e-df485179cdca'::uuid,
    '02482056-f3c1-4c75-8583-e99c66a72baf'::uuid
  );
END
$fix_four_manual_dates$;
