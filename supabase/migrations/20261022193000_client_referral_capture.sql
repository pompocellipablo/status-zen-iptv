-- Referral captured at client registration. Additive: existing clients are unaffected.
alter table public.clients
  add column if not exists referred_by_client_id uuid references public.clients(id) on delete set null,
  add column if not exists referral_first_payment_confirmed boolean not null default false;

create index if not exists clients_referred_by_idx
  on public.clients(referred_by_client_id) where referred_by_client_id is not null;

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
      )
    then
      raise exception 'Esta indicação já gerou pontos e não pode ser alterada.';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists referral_validate_client_link on public.clients;
create trigger referral_validate_client_link
  before insert or update of referred_by_client_id, referral_first_payment_confirmed
  on public.clients for each row execute function public.referral_validate_client_link();

-- Existing manual referral registration remains supported. Additionally persist the referring
-- client on the referred client record so both registration and manual flows agree.
create or replace function public.referral_award(
  p_client_id uuid, p_referred_client_id uuid, p_payment_confirmed boolean
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_client public.clients%rowtype;
  v_referred public.clients%rowtype;
begin
  if p_payment_confirmed is distinct from true then
    raise exception 'Confirme o primeiro pagamento antes de pontuar.';
  end if;
  if p_client_id = p_referred_client_id then
    raise exception 'Não é permitido indicar a própria conta.';
  end if;
  select * into v_client from public.clients where id=p_client_id for update;
  if not found then raise exception 'Cliente indicador não encontrado.'; end if;
  if v_client.due_date < (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'A conta do indicador precisa estar ativa para pontuar.';
  end if;
  select * into v_referred from public.clients where id=p_referred_client_id for update;
  if not found then raise exception 'Cliente indicado não encontrado.'; end if;
  if v_referred.referred_by_client_id is not null
     and v_referred.referred_by_client_id <> p_client_id then
    raise exception 'O cliente indicado está vinculado a outro indicador.';
  end if;
  if exists (select 1 from public.referral_point_movements
             where referred_client_id = p_referred_client_id and kind = 'indicacao') then
    raise exception 'Este cliente já gerou ponto por indicação.';
  end if;

  insert into public.referral_point_movements(client_id,referred_client_id,kind,points,note)
    values (p_client_id,p_referred_client_id,'indicacao',1,'Primeiro pagamento confirmado');

  update public.clients
    set referred_by_client_id = p_client_id, referral_first_payment_confirmed = true
    where id = p_referred_client_id;
exception when unique_violation then
  raise exception 'Este cliente indicado já gerou ponto por indicação.';
end; $$;

-- Confirmation from the client form produces the ledger entry in the SAME transaction,
-- so a failed award rolls back the edit/creation automatically.
create or replace function public.referral_register_confirmed_payment()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.referral_first_payment_confirmed and new.referred_by_client_id is not null
     and not exists (
       select 1 from public.referral_point_movements
       where referred_client_id = new.id and kind = 'indicacao'
     )
  then
    perform public.referral_award(new.referred_by_client_id,new.id,true);
  end if;
  return new;
end; $$;

drop trigger if exists referral_register_confirmed_payment on public.clients;
create trigger referral_register_confirmed_payment
  after insert or update of referred_by_client_id, referral_first_payment_confirmed
  on public.clients for each row execute function public.referral_register_confirmed_payment();

comment on column public.clients.referred_by_client_id is
  'Optional referring client, selected when a new customer is registered.';
comment on column public.clients.referral_first_payment_confirmed is
  'Explicit human confirmation of the first payment; triggers exactly one referral point.';
