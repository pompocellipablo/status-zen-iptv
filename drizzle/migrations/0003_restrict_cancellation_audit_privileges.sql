-- Remove inherited/default privileges beyond the owner-only read and insert audit flow.
REVOKE ALL ON public.external_renewal_cancellations FROM authenticated,anon,PUBLIC;
GRANT SELECT,INSERT ON public.external_renewal_cancellations TO authenticated;
GRANT ALL ON public.external_renewal_cancellations TO service_role;