-- MaxFlix: generic campaign send ledger, one status per campaign and WhatsApp
-- phone. Applied additively to the current Lovable Cloud project (2026-11-16).
-- Never mark as sent simply because WhatsApp was opened. Owner confirms manually.
create table if not exists public.whatsapp_campaign_tracking (
  campaign_key text not null check (length(campaign_key) between 3 and 80),
  phone text not null check (phone ~ '^[0-9]{10,16}$'),
  client_id uuid references public.clients(id) on delete set null,
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (campaign_key, phone)
);
alter table public.whatsapp_campaign_tracking enable row level security;
drop policy if exists whatsapp_campaign_tracking_owner on public.whatsapp_campaign_tracking;
create policy whatsapp_campaign_tracking_owner
  on public.whatsapp_campaign_tracking for all to authenticated
  using ((select auth.uid()) = 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid)
  with check ((select auth.uid()) = 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid);
revoke all on table public.whatsapp_campaign_tracking from public, anon, authenticated;
grant select,insert,update,delete on table public.whatsapp_campaign_tracking to authenticated;
comment on table public.whatsapp_campaign_tracking is
  'Manual WhatsApp campaign send status by campaign and normalized destination phone, separate from migration tracking; opening WhatsApp never automatically marks sent.';
