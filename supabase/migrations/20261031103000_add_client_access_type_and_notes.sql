-- Client classification is owner-managed: never infer gratuity from a zero payment.
-- Historical, already-paid package months can also show paid=0.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS access_type text NOT NULL DEFAULT 'padrao',
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_access_type_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_access_type_check
  CHECK (access_type IN ('padrao','pacote_pago','gratuidade','meu_acesso'));
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_notes_length_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_notes_length_check
  CHECK (notes IS NULL OR char_length(notes) <= 3000);

COMMENT ON COLUMN public.clients.access_type IS 'Explicit administrative classification: padrao, pacote_pago, gratuidade familia/amigos, meu_acesso/testes. Defaults to unclassified.';
COMMENT ON COLUMN public.clients.notes IS 'Private administrative notes about the subscription. No contact message uses this field.';
