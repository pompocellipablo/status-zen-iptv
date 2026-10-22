-- Allow the existing manual referral flow to annotate a customer after the
-- point was recorded, but only with the SAME verified referring client.
-- All later reassignment/removal of credited attribution remains blocked.
create or replace function public.referral_validate_client_link()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.referred_by_client_id is not null and new.referred_by_client_id = new.id then
    raise exception 'Um cliente não pode indicar a própria conta.';
  end if;
  if tg_op = 'UPDATE' then
    if old.referral_first_payment_confirmed and not new.referral_first_payment_confirmed then
      raise exception 'Um pagamento de indicação já confirmado não pode ser desfeito.';
    end if;
    if new.referred_by_client_id is distinct from old.referred_by_client_id
      and exists (
        select 1 from public.referral_point_movements m
        where m.referred_client_id = new.id and m.kind = 'indicacao'
          and (old.referred_by_client_id is not null
            or new.referred_by_client_id is distinct from m.client_id)
      )
    then
      raise exception 'Esta indicação já gerou pontos e não pode ser alterada.';
    end if;
  end if;
  return new;
end; $$;