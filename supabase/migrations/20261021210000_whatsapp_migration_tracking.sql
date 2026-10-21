-- MaxFlix: campaign progress stored separately from subscription and financial records.
-- Additive schema: to be applied to the original Lovable Cloud database before publishing.
-- Keep this migration in the future cutover checklist for the personal Supabase.

create table if not exists public.whatsapp_migration_tracking (
  client_id uuid primary key references public.clients(id) on delete cascade,
  phone_reviewed boolean not null default false,
  agenda_updated boolean not null default false,
  sent_at timestamptz,
  replied_at timestamptz,
  payer_name text check (payer_name is null or char_length(payer_name) <= 120),
  updated_at timestamptz not null default now(),
  constraint migration_reply_requires_sent check (replied_at is null or sent_at is not null)
);

create index if not exists whatsapp_migration_tracking_sent_idx
  on public.whatsapp_migration_tracking(sent_at);

alter table public.whatsapp_migration_tracking enable row level security;

-- The same single authenticated owner allowed on clients.
do $sql$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'whatsapp_migration_tracking'
      and policyname = 'whatsapp_migration_tracking_owner'
  ) then
    create policy whatsapp_migration_tracking_owner
      on public.whatsapp_migration_tracking for all to authenticated
      using (
        (select auth.uid()) = 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid
        and exists (select 1 from public.clients c where c.id = client_id)
      )
      with check (
        (select auth.uid()) = 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid
        and exists (select 1 from public.clients c where c.id = client_id)
      );
  end if;
end;
$sql$;

-- Supabase projects may grant ALL table privileges to anon/authenticated by default.
-- Explicitly remove TRUNCATE/TRIGGER/REFERENCES and all anonymous access.
revoke all privileges on table public.whatsapp_migration_tracking from public, anon, authenticated;
grant select, insert, update, delete on public.whatsapp_migration_tracking to authenticated;

comment on table public.whatsapp_migration_tracking is
  'Manual review and WhatsApp migration campaign status per existing client login; no automated sending.';
