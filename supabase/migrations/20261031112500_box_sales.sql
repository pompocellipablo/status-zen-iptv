-- Device sales stay independent of IPTV subscriptions and their renewals.
-- Legacy sales with unknown amounts remain NULL (never fabricate revenue/profit).
CREATE TABLE IF NOT EXISTS public.box_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name text NOT NULL,
  sale_date date,
  model text,
  quantity integer CHECK (quantity IS NULL OR (quantity BETWEEN 1 AND 100)),
  amount_received numeric(12,2) CHECK (amount_received IS NULL OR amount_received >= 0),
  device_cost numeric(12,2) CHECK (device_cost IS NULL OR device_cost >= 0),
  extra_cost numeric(12,2) NOT NULL DEFAULT 0 CHECK (extra_cost >= 0),
  months_included integer NOT NULL DEFAULT 12 CHECK (months_included BETWEEN 1 AND 120),
  notes text CHECK (notes IS NULL OR length(notes) <= 3000),
  historical_source text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.box_sale_clients (
  sale_id uuid NOT NULL REFERENCES public.box_sales(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  PRIMARY KEY (sale_id,client_id)
);
CREATE INDEX IF NOT EXISTS box_sale_clients_client_idx ON public.box_sale_clients(client_id);

ALTER TABLE public.box_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.box_sale_clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner manages box sales" ON public.box_sales;
CREATE POLICY "Owner manages box sales" ON public.box_sales
FOR ALL TO authenticated
USING ((select auth.uid()) = 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid)
WITH CHECK ((select auth.uid()) = 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid);

DROP POLICY IF EXISTS "Owner manages box sale client links" ON public.box_sale_clients;
CREATE POLICY "Owner manages box sale client links" ON public.box_sale_clients
FOR ALL TO authenticated
USING ((select auth.uid()) = 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid)
WITH CHECK ((select auth.uid()) = 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid);

-- Historical clients confirmed as TV Box buyers by the owner (31/10/2026).
-- These are buyer records, not confirmed counts of boxes; prices and costs unknown.
INSERT INTO public.box_sales(customer_name, historical_source, months_included, notes)
VALUES
 ('CelioJardim', 'legacy-celio-jardim', 12, 'Venda antiga confirmada; valores e quantidade de aparelhos a conferir.'),
 ('Ezemberge', 'legacy-ezemberge', 12, 'Venda antiga confirmada; dois acessos associados. Verificar quantidade de aparelhos.'),
 ('Jonas Meneguite', 'legacy-jonas-meneguite', 12, 'Venda antiga confirmada; valores e quantidade de aparelhos a conferir.'),
 ('MarcosHonorato', 'legacy-marcos-honorato', 12, 'Venda antiga confirmada; dois acessos associados. Verificar quantidade de aparelhos.'),
 ('RenatoLouzada', 'legacy-renato-louzada', 12, 'Venda antiga confirmada; valores e quantidade de aparelhos a conferir.'),
 ('Martha Teixeira - Proeletronic', 'legacy-martha-teixeira', 12, 'Venda antiga confirmada; valores e quantidade de aparelhos a conferir.'),
 ('AugustoJose', 'legacy-jose-augusto', 12, 'Referência informada pelo proprietário como José Augusto; confirmar se AugustoJose é o cadastro correto.')
ON CONFLICT (historical_source) DO NOTHING;

-- Link all precisely matched IPTV accounts, preserving their dates and financial fields.
WITH confirmed(source_key,login) AS (VALUES
 ('legacy-celio-jardim','CelioJardim'),
 ('legacy-ezemberge','Ezemberge'),
 ('legacy-ezemberge','Ezemberge2'),
 ('legacy-jonas-meneguite','JonasMeneguite'),
 ('legacy-marcos-honorato','MarcosHonorato'),
 ('legacy-marcos-honorato','MarcosHonorato2'),
 ('legacy-renato-louzada','RenatoLouzada'),
 ('legacy-martha-teixeira','MarthaTeixeira'),
 ('legacy-jose-augusto','AugustoJose')
)
INSERT INTO public.box_sale_clients (sale_id,client_id)
SELECT s.id,c.id
FROM confirmed k
JOIN public.box_sales s ON s.historical_source=k.source_key
JOIN public.clients c ON c.login=k.login
ON CONFLICT DO NOTHING;
