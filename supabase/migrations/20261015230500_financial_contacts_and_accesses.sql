-- MAXFLIX - Financial contacts and individual access links.
-- Additive schema for the user's personal Supabase project.
-- DO NOT apply to Lovable Cloud and DO NOT use to resync client records.
-- Existing clients/payments/credits/renewal functions are unchanged.

create table if not exists public.financial_contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  whatsapp text,
  phone_reviewed boolean not null default false,
  payment_preference text not null default 'combinado'
    check (payment_preference in ('juntos', 'separados', 'combinado')),
  notes text not null default '' check (char_length(notes) <= 1000),
  created_automatically boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_contacts_whatsapp_format check (
    whatsapp is null or (whatsapp ~ '^[0-9]{10,13}$')
  ),
  constraint financial_contacts_reviewed_requires_phone check (
    phone_reviewed = false or whatsapp is not null
  )
);

create table if not exists public.financial_contact_accesses (
  client_id uuid primary key references public.clients(id) on delete cascade,
  contact_id uuid not null references public.financial_contacts(id) on delete cascade,
  access_label text not null default '' check (char_length(access_label) <= 80),
  linked_at timestamptz not null default now()
);

create index if not exists financial_contacts_owner_name_idx
  on public.financial_contacts (owner_id, name);
create index if not exists financial_contact_accesses_contact_idx
  on public.financial_contact_accesses (contact_id);

alter table public.financial_contacts enable row level security;
alter table public.financial_contact_accesses enable row level security;

-- Same single authenticated panel owner enforced by the existing clients table.
-- RLS policies are additive; never grant access to anon.
create policy financial_contacts_select_owner
  on public.financial_contacts for select to authenticated
  using (owner_id = (select auth.uid())
    and (select auth.uid()) = 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid);

create policy financial_contacts_insert_owner
  on public.financial_contacts for insert to authenticated
  with check (owner_id = (select auth.uid())
    and (select auth.uid()) = 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid);

create policy financial_contacts_update_owner
  on public.financial_contacts for update to authenticated
  using (owner_id = (select auth.uid())
    and (select auth.uid()) = 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid)
  with check (owner_id = (select auth.uid())
    and (select auth.uid()) = 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid);

create policy financial_contacts_delete_owner
  on public.financial_contacts for delete to authenticated
  using (owner_id = (select auth.uid())
    and (select auth.uid()) = 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid);

-- A link can only point at a contact belonging to the authenticated owner.
create policy financial_contact_accesses_select_owner
  on public.financial_contact_accesses for select to authenticated
  using (exists (
    select 1 from public.financial_contacts c
    where c.id = contact_id and c.owner_id = (select auth.uid())
  ));

create policy financial_contact_accesses_insert_owner
  on public.financial_contact_accesses for insert to authenticated
  with check (exists (
    select 1 from public.financial_contacts c
    where c.id = contact_id and c.owner_id = (select auth.uid())
  ));

create policy financial_contact_accesses_update_owner
  on public.financial_contact_accesses for update to authenticated
  using (exists (
    select 1 from public.financial_contacts c
    where c.id = contact_id and c.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.financial_contacts c
    where c.id = contact_id and c.owner_id = (select auth.uid())
  ));

create policy financial_contact_accesses_delete_owner
  on public.financial_contact_accesses for delete to authenticated
  using (exists (
    select 1 from public.financial_contacts c
    where c.id = contact_id and c.owner_id = (select auth.uid())
  ));

grant select, insert, update, delete on public.financial_contacts to authenticated;
grant select, insert, update, delete on public.financial_contact_accesses to authenticated;

comment on table public.financial_contacts is
  'Contacts responsible for payments and outbound WhatsApp communications. Not individual IPTV access records.';
comment on table public.financial_contact_accesses is
  'Independent clients belong to a financial contact; client due dates, server, payments and renewal rules remain unchanged.';
