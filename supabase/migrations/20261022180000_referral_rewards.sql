-- MaxFlix referral program (additive, no backfill or changes to payments).
-- This migration targets the current Lovable Cloud owner and must be revalidated on an external Supabase cutover.
do $guard$
begin
  if not exists (
    select 1 from auth.users where id = 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid
  ) then
    raise exception 'MaxFlix account owner not found: verify the owner before applying referral program.';
  end if;
end $guard$;

create table if not exists public.referral_point_movements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  referred_client_id uuid references public.clients(id) on delete set null,
  kind text not null check (kind in ('indicacao', 'resgate', 'expiracao')),
  points integer not null check (points <> 0),
  note text,
  created_at timestamptz not null default now(),
  constraint referral_points_sign check (
    (kind = 'indicacao' and points = 1 and referred_client_id is not null)
    or (kind in ('resgate', 'expiracao') and points < 0 and referred_client_id is null)
  ),
  constraint referral_no_self check (referred_client_id is null or referred_client_id <> client_id)
);
create unique index if not exists referral_unique_paying_client
  on public.referral_point_movements (referred_client_id) where kind = 'indicacao';
create index if not exists referral_movements_client_date
  on public.referral_point_movements (client_id, created_at desc);

create table if not exists public.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  movement_id uuid not null unique references public.referral_point_movements(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  reward text not null check (reward in ('mes_gratis','fire_stick','hy320')),
  status text not null default 'pendente' check (status in ('pendente','concluido')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint referral_reward_status_check check (
    (status = 'pendente' and completed_at is null)
    or (status = 'concluido' and completed_at is not null)
  )
);
create index if not exists referral_rewards_client_status
  on public.referral_rewards (client_id, status);

alter table public.referral_point_movements enable row level security;
alter table public.referral_rewards enable row level security;
revoke all on public.referral_point_movements, public.referral_rewards from public, anon, authenticated;
grant select, insert on public.referral_point_movements to authenticated;
grant select, insert, update on public.referral_rewards to authenticated;
create policy referral_points_owner_read
  on public.referral_point_movements for select to authenticated
  using ((select auth.uid()) = 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid);
create policy referral_points_owner_insert
  on public.referral_point_movements for insert to authenticated
  with check ((select auth.uid()) = 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid);
create policy referral_rewards_owner_read
  on public.referral_rewards for select to authenticated
  using ((select auth.uid()) = 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid);
create policy referral_rewards_owner_insert
  on public.referral_rewards for insert to authenticated
  with check ((select auth.uid()) = 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid);
create policy referral_rewards_owner_update
  on public.referral_rewards for update to authenticated
  using ((select auth.uid()) = 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid)
  with check ((select auth.uid()) = 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid);

-- The service is active through the due date. More than one full day inactive:
-- Brazil local date >= previous due date + 2 days.
create or replace function public.referral_expire_client(p_client_id uuid)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_due date;
  v_balance integer;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select due_date into v_due from public.clients where id=p_client_id;
  if not found or v_due > v_today - 2 then return 0; end if;
  select coalesce(sum(points),0) into v_balance
    from public.referral_point_movements where client_id=p_client_id;
  if v_balance > 0 then
    insert into public.referral_point_movements(client_id,kind,points,note)
      values (p_client_id,'expiracao',-v_balance,'Assinatura inativa por mais de um dia');
    return v_balance;
  end if;
  return 0;
end; $$;

create or replace function public.referral_reset_expired()
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_client record;
  v_expired integer;
  v_count integer := 0;
begin
  for v_client in
    select c.id from public.clients c
    where c.due_date <= (now() at time zone 'America/Sao_Paulo')::date - 2
      and exists (select 1 from public.referral_point_movements m where m.client_id = c.id)
    for update of c
  loop
    v_expired := public.referral_expire_client(v_client.id);
    if v_expired > 0 then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end; $$;

create or replace function public.referral_expire_on_late_renewal()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.due_date > old.due_date
     and old.due_date <= (now() at time zone 'America/Sao_Paulo')::date - 2
  then
    -- OLD due date must be evaluated before it is replaced by the renewal.
    insert into public.referral_point_movements (client_id, kind, points, note)
      select old.id, 'expiracao', -sum(m.points),
             'Pontos zerados ao renovar após mais de um dia inativo'
      from public.referral_point_movements m
      where m.client_id = old.id
      having sum(m.points) > 0;
  end if;
  return new;
end; $$;
drop trigger if exists referral_expire_on_late_renewal on public.clients;
create trigger referral_expire_on_late_renewal
  after update of due_date on public.clients
  for each row execute function public.referral_expire_on_late_renewal();

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
  if p_client_id = p_referred_client_id then raise exception 'Não é permitido indicar a própria conta.'; end if;
  select * into v_client from public.clients where id=p_client_id for update;
  if not found then raise exception 'Cliente indicador não encontrado.'; end if;
  if v_client.due_date < (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'A conta do indicador precisa estar ativa para pontuar.';
  end if;
  select * into v_referred from public.clients where id=p_referred_client_id;
  if not found then raise exception 'Cliente indicado não encontrado.'; end if;
  insert into public.referral_point_movements(client_id,referred_client_id,kind,points,note)
    values (p_client_id,p_referred_client_id,'indicacao',1,'Primeiro pagamento confirmado manualmente');
exception when unique_violation then
  raise exception 'Este cliente indicado já gerou ponto para outra indicação.';
end; $$;

create or replace function public.referral_claim(
  p_client_id uuid, p_reward text
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_client public.clients%rowtype;
  v_balance integer;
  v_cost integer;
  v_movement_id uuid;
  v_reward_id uuid;
begin
  if p_reward not in ('mes_gratis','fire_stick','hy320') or p_reward is null then
    raise exception 'Recompensa inválida.';
  end if;
  v_cost := case when p_reward='mes_gratis' then 2 else 10 end;
  select * into v_client from public.clients where id=p_client_id for update;
  if not found then raise exception 'Cliente não encontrado.'; end if;
  if v_client.due_date < (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'A assinatura precisa estar ativa para resgatar.';
  end if;
  select coalesce(sum(points),0) into v_balance
    from public.referral_point_movements where client_id=p_client_id;
  if v_balance < v_cost then raise exception 'Pontos insuficientes para esta recompensa.'; end if;
  insert into public.referral_point_movements(client_id,kind,points,note)
    values(p_client_id,'resgate',-v_cost,case p_reward when 'mes_gratis' then '1 mês grátis'
      when 'fire_stick' then 'Fire TV Stick' else 'Projetor HY320' end)
    returning id into v_movement_id;
  insert into public.referral_rewards(movement_id,client_id,reward)
    values(v_movement_id,p_client_id,p_reward) returning id into v_reward_id;
  return v_reward_id;
end; $$;

-- Apply a previously redeemed free month only when no paid package still covers the cycle.
-- Payment stays zero and server renewal stock is debited once by the existing atomic RPC.
create or replace function public.referral_use_free_month(
  p_client_id uuid, p_expected_due_date date
) returns date language plpgsql security invoker set search_path = '' as $$
declare
  v_client public.clients%rowtype;
  v_reward_id uuid;
  v_due date;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into v_client from public.clients where id=p_client_id for update;
  if not found then raise exception 'Cliente não encontrado.'; end if;
  if v_client.due_date <> p_expected_due_date then
    raise exception 'Vencimento alterado. Atualize e tente novamente.';
  end if;
  if coalesce(v_client.financial_due_date,v_client.due_date) > v_client.due_date then
    raise exception 'Ainda há meses pagos no pacote. O resgate será usado após o pacote.';
  end if;
  select id into v_reward_id from public.referral_rewards
    where client_id=p_client_id and reward='mes_gratis' and status='pendente'
    order by created_at asc, id asc limit 1 for update;
  if not found then raise exception 'Nenhuma mensalidade grátis pendente.'; end if;
  v_due := (greatest(v_client.due_date,v_today) + interval '1 month')::date;
  perform public.renew_client_with_credit(
    p_client_id,v_client.due_date,v_due,v_due,
    case when v_client.cost > 0 then v_client.cost else v_client.prev_cost end,
    0,
    case when v_client.prev_paid > 0 then v_client.prev_paid else v_client.paid end,
    0,0
  );
  update public.referral_rewards set status='concluido',completed_at=now()
    where id=v_reward_id;
  return v_due;
end; $$;

create or replace function public.referral_mark_delivered(p_reward_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.referral_rewards set status='concluido',completed_at=now()
    where id=p_reward_id and reward in ('fire_stick','hy320') and status='pendente';
  if not found then raise exception 'Prêmio não encontrado ou já entregue.'; end if;
end; $$;

revoke execute on function public.referral_expire_client(uuid) from public, anon;
revoke execute on function public.referral_reset_expired() from public, anon;
revoke execute on function public.referral_award(uuid,uuid,boolean) from public, anon;
revoke execute on function public.referral_claim(uuid,text) from public, anon;
revoke execute on function public.referral_use_free_month(uuid,date) from public, anon;
revoke execute on function public.referral_mark_delivered(uuid) from public, anon;
grant execute on function public.referral_expire_client(uuid) to authenticated;
grant execute on function public.referral_reset_expired() to authenticated;
grant execute on function public.referral_award(uuid,uuid,boolean) to authenticated;
grant execute on function public.referral_claim(uuid,text) to authenticated;
grant execute on function public.referral_use_free_month(uuid,date) to authenticated;
grant execute on function public.referral_mark_delivered(uuid) to authenticated;