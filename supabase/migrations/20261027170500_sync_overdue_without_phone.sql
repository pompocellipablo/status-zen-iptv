-- Regras da reconquista: preservar tambem clientes antigos sem telefone.
-- Cada cliente sem numero permanece identificado pelo seu ID original.
CREATE UNIQUE INDEX IF NOT EXISTS former_clients_linked_client_unique
ON public.former_clients (linked_client_id)
WHERE linked_client_id IS NOT NULL;

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
    RAISE EXCEPTION 'Acesso restrito ao administrador.' USING ERRCODE='42501';
  END IF;

  WITH normalized AS (
    SELECT
      c.id, c.name, c.server, c.due_date,
      CASE
        WHEN length(regexp_replace(coalesce(c.whatsapp,''), '[^0-9]', '', 'g')) = 0
          THEN NULL
        WHEN length(regexp_replace(c.whatsapp, '[^0-9]', '', 'g')) IN (10,11)
          THEN '55' || regexp_replace(c.whatsapp, '[^0-9]', '', 'g')
        ELSE regexp_replace(c.whatsapp, '[^0-9]', '', 'g')
      END AS phone
    FROM public.clients c
    WHERE c.due_date < ((now() AT TIME ZONE 'America/Sao_Paulo')::date - 10)
      AND (c.financial_due_date IS NULL
        OR c.financial_due_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date)
  ),
  eligible AS (
    SELECT
      n.*,
      row_number() OVER (
        PARTITION BY coalesce(n.phone, n.id::text)
        ORDER BY n.due_date DESC, n.id
      ) AS rn
    FROM normalized n
    WHERE (
      n.phone IS NULL
      OR (left(n.phone,2) = '55' AND length(n.phone) IN (12,13))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.clients a
      WHERE n.phone IS NOT NULL
        AND a.id <> n.id
        AND (
          a.due_date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date
          OR a.financial_due_date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date
        )
        AND (
          CASE
            WHEN length(regexp_replace(coalesce(a.whatsapp,''),'[^0-9]','','g')) IN (10,11)
              THEN '55'||regexp_replace(a.whatsapp,'[^0-9]','','g')
            ELSE regexp_replace(coalesce(a.whatsapp,''),'[^0-9]','','g')
          END
        ) = n.phone
    )
  ),
  inserted AS (
    INSERT INTO public.former_clients
      (name,phone,server,origin,status,contact_permission,linked_client_id)
    SELECT e.name,e.phone,e.server,'painel_vencido','identificado','desconhecida',e.id
    FROM eligible e
    WHERE e.rn = 1
    ON CONFLICT DO NOTHING
    RETURNING id
  ),
  logged AS (
    INSERT INTO public.former_client_events
      (former_client_id,action,to_status,note)
    SELECT
      id, 'criado', 'identificado',
      'Incluído após mais de 10 dias de vencimento, com ou sem WhatsApp'
    FROM inserted
    RETURNING id
  )
  SELECT COUNT(*) INTO inserted_count FROM logged;
  RETURN inserted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_overdue_former_clients() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_overdue_former_clients() TO authenticated;
COMMENT ON FUNCTION public.sync_overdue_former_clients() IS
  'Importa vencidos acima de 10 dias, inclusive sem telefone. Exclui pacotes com cobertura futura e contatos ligados a assinaturas ativas; não altera clients. É idempotente por telefone ou ID de origem.';