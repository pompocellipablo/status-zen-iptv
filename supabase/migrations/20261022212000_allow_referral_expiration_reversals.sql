-- Expand the original movement-kind check for audited point corrections.
ALTER TABLE public.referral_point_movements
  DROP CONSTRAINT IF EXISTS referral_point_movements_kind_check;
ALTER TABLE public.referral_point_movements
  ADD CONSTRAINT referral_point_movements_kind_check
  CHECK (kind IN ('indicacao','resgate','expiracao','estorno'));
