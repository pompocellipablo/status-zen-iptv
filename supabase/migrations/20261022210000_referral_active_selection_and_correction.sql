-- Only active customers can participate in NEW referrals.
-- Existing links/history remain untouched, including links to inactive referrers.
-- Point expiry keeps an immutable audit history; manual correction is a separate
-- explicit reversing movement, never a new referral or a deleted row.
ALTER TABLE public.referral_point_movements
  ADD COLUMN IF NOT EXISTS reversed_expiration_id uuid
    REFERENCES public.referral_point_movements(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS referral_one_reversal_per_expiration
  ON public.referral_point_movements(reversed_expiration_id)
  WHERE reversed_expiration_id IS NOT NULL;

ALTER TABLE public.referral_point_movements DROP CONSTRAINT IF EXISTS referral_points_sign;
ALTER TABLE public.referral_point_movements ADD CONSTRAINT referral_points_sign CHECK (
  (kind = 'indicacao' AND points = 1 AND referred_client_id IS NOT NULL
    AND reversed_expiration_id IS NULL)
  OR (kind IN ('resgate','expiracao') AND points < 0
    AND referred_client_id IS NULL AND reversed_expiration_id IS NULL)
  OR (kind = 'estorno' AND points > 0
    AND referred_client_id IS NULL AND reversed_expiration_id IS NOT NULL)
);

CREATE OR REPLACE FUNCTION public.referral_restore_expiration(
  p_client_id uuid, p_expiration_id uuid
) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_due date;
  v_expiration public.referral_point_movements%ROWTYPE;
  v_points integer;
BEGIN
  -- Serialize restores with referral award, claim and renew operations.
  SELECT due_date INTO v_due FROM public.clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente não encontrado.'; END IF;
  IF v_due < (now() at time zone 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'Corrija primeiro o vencimento no cadastro. A assinatura precisa estar ativa.';
  END IF;

  SELECT * INTO v_expiration
  FROM public.referral_point_movements
  WHERE id = p_expiration_id AND client_id = p_client_id AND kind = 'expiracao'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro de expiração não encontrado.'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.referral_point_movements
    WHERE reversed_expiration_id = v_expiration.id
  ) THEN
    RAISE EXCEPTION 'Estes pontos já foram restaurados.';
  END IF;

  -- Do not restore an old expiration if a newer expiration happened afterwards.
  IF EXISTS (
    SELECT 1 FROM public.referral_point_movements m
    WHERE m.client_id = p_client_id AND m.kind = 'expiracao'
      AND (m.created_at, m.id) > (v_expiration.created_at, v_expiration.id)
  ) THEN
    RAISE EXCEPTION 'Somente a última expiração pode ser revisada.';
  END IF;

  v_points := -v_expiration.points;
  INSERT INTO public.referral_point_movements (
    client_id, kind, points, reversed_expiration_id, note
  ) VALUES (
    p_client_id, 'estorno', v_points, v_expiration.id,
    'Revisão manual: vencimento corrigido no cadastro'
  );
  RETURN v_points;
END; $$;

REVOKE ALL ON FUNCTION public.referral_restore_expiration(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_restore_expiration(uuid,uuid) TO authenticated;

-- Guard direct RPC and registration flow as well as the UI. This does not
-- delete/modify records belonging to customers whose status later changes.
CREATE OR REPLACE FUNCTION public.referral_award(
  p_client_id uuid, p_referred_client_id uuid, p_payment_confirmed boolean
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_client public.clients%ROWTYPE;
  v_referred public.clients%ROWTYPE;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
BEGIN
  IF p_payment_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Confirme o primeiro pagamento antes de pontuar.';
  END IF;
  IF p_client_id = p_referred_client_id THEN
    RAISE EXCEPTION 'Não é permitido indicar a própria conta.';
  END IF;

  SELECT * INTO v_client FROM public.clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente indicador não encontrado.'; END IF;
  IF v_client.due_date < v_today THEN
    RAISE EXCEPTION 'O indicador precisa estar ativo para receber novas indicações.';
  END IF;

  SELECT * INTO v_referred FROM public.clients WHERE id = p_referred_client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente indicado não encontrado.'; END IF;
  IF v_referred.due_date < v_today THEN
    RAISE EXCEPTION 'O cliente indicado está vencido. Corrija a data antes de confirmar.';
  END IF;
  IF v_referred.referred_by_client_id IS NOT NULL
    AND v_referred.referred_by_client_id <> p_client_id THEN
    RAISE EXCEPTION 'O cliente indicado está vinculado a outro indicador.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.referral_point_movements
    WHERE referred_client_id = p_referred_client_id AND kind = 'indicacao'
  ) THEN
    RAISE EXCEPTION 'Este cliente já gerou ponto por indicação.';
  END IF;

  INSERT INTO public.referral_point_movements(client_id,referred_client_id,kind,points,note)
    VALUES(p_client_id,p_referred_client_id,'indicacao',1,'Primeiro pagamento confirmado');

  UPDATE public.clients SET
    referred_by_client_id = p_client_id, referral_first_payment_confirmed = true
    WHERE id = p_referred_client_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Este cliente indicado já gerou ponto por indicação.';
END; $$;

COMMENT ON COLUMN public.referral_point_movements.reversed_expiration_id IS
  'Audit link for a manually corrected, formerly expired points balance. One restoration per expiration; historical indications remain intact.';
