-- MaxFlix / Painel Recarga: owner-controlled overdue renewal gate.
-- Additive one-column change to the existing owner-scoped settings table.
-- This switch is independent of general rollout and global LIVE gating.
-- Expired >10 days remain blocked by broadOverdueEligible in backend.
-- Applied only after code passes tests; this file documents the exact SQL.
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS panel_overdue_enabled boolean NOT NULL DEFAULT false;

-- Explicitly requested enablement on 2026-11-18. The authenticated owner
-- remains the only user authorized by the existing settings RLS policy.
UPDATE public.settings
  SET panel_overdue_enabled = true, updated_at = now()
  WHERE id = 'default';
