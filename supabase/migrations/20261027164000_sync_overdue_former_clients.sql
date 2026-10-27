-- Sincroniza assinaturas vencidas há mais de 10 dias para a base separada de reconquista.
-- Execução apenas pelo dono autenticado. SECURITY INVOKER preserva as RLS das tabelas.
-- Nunca exclui nem altera o cadastro principal de clientes.
CREATE OR REPLACE FUNCTION public.sync_overdue_former_clients()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  inserted_count integer := 0;
BEGIN
  IF (SELECT auth.uid()) IS DISTINCT FROM 'c70b3e1f-e5d2-4caf-ae09-019964dbf30e'::uuid THEN
    RAISE EXCEPTION 'Acesso restrito ao administrador.' USING ERRCODE = '42501';
  END IF;

  WITH normalized AS (
    SELECT
      c.id, c.name, c.server, c.due_date,
      CASE
        WHEN length(regexp_replace(coalesce(c.whatsapp,''), '[^0-9]', '', 'g')) IN (10,11)
          THEN '55' || regexp_replace(coalesce(c.whatsapp,''), '[^0-9]', '', 'g')
        ELSE regexp_replace(coalesce(c.whatsapp,''), '[^0-9]', '', 'g')
      END AS phone
    FROM public.clients AS c
    WHERE c.due_date < ((now() AT TIME ZONE 'America/Sao_Paulo')::date - 10)
      AND (c.financial_due_date IS NULL
        OR c.financial_due_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date)
  ),
  eligible AS (
    SELECT
      n.*,
      row_number() OVER (PARTITION BY n.phone ORDER BY n.due_date DESC, n.id) AS rn
    FROM normalized n
    WHERE length(n.phone) IN (12,13)
      AND left(n.phone,2) = '55'
      AND NOT EXISTS (
        SELECT 1 FROM public.clients AS active
        WHERE active.id <> n.id
          AND (
            active.due_date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date
            OR active.financial_due_date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date
          )
          AND (
            CASE
              WHEN length(regexp_replace(coalesce(active.whatsapp,''), '[^0-9]', '', 'g')) IN (10,11)
                THEN '55' || regexp_replace(coalesce(active.whatsapp,''), '[^0-9]', '', 'g')
              ELSE regexp_replace(coalesce(active.whatsapp,''), '[^0-9]', '', 'g')
            END
          ) = n.phone
      )
  ),
  inserted AS (
    INSERT INTO public.former_clients
      (name, phone, server, origin, status, contact_permission, linked_client_id)
    SELECT
      e.name, e.phone, e.server, 'painel_vencido', 'identificado', 'desconhecida', e.id
    FROM eligible e
    WHERE e.rn = 1
    ON CONFLICT (phone) WHERE phone IS NOT NULL DO NOTHING
    RETURNING id
  ),
  logged AS (
    INSERT INTO public.former_client_events (former_client_id, action, to_status, note)
    SELECT id, 'criado', 'identificado', 'Incluído automaticamente após mais de 10 dias de vencimento'
    FROM inserted
    RETURNING id
  )
  SELECT count(*) INTO inserted_count FROM logged;

  RETURN inserted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_overdue_former_clients() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_overdue_former_clients() TO authenticated;
COMMENT ON FUNCTION public.sync_overdue_former_clients() IS
  'Importa apenas novos ex-clientes com telefone válido, mais de 10 dias vencidos e sem cobertura financeira ou acesso ativo no mesmo número. Não remove clientes nem altera status de registros já existentes.';