# MaxFlix — Renovação integrada de clientes vencidos

Status: **preparado no GitHub; NÃO implantado no Lovable Cloud**.

## Regras de negócio
- O usuário proprietário confirma explicitamente que recebeu a mensalidade e informa **a data real do pagamento** (Pix/transferência). Nada acontece só porque a conta venceu.
- Para mensalidade paga depois do vencimento, a nova data financeira é a data de recebimento + **1 mês de calendário**. A data técnica deverá ser confirmada pelo servidor.
- Apenas clientes *padrão*, com vencimento vencido, técnico e financeiro iguais, mensalidade e custo atuais zerados, e `prev_paid/prev_cost > 0` são elegíveis. Acesso grátis, pacotes pré-pagos e Elite ficam fora.
- O fluxo inicial aceita **somente 1 mês**, pelo valor da mensalidade anterior (`prev_paid`) e custo técnico anterior (`prev_cost`). Reajustes, condições especiais e pacotes de 6/12 meses exigem outro fluxo/manual.
- A API do fornecedor é chamada no máximo com **1 ciclo**, com chave de idempotência preservada. É exigido pré-teste, confirmação humana e travas contra envio duplicado.
- Se o vencimento retornado pelo servidor **não for exatamente** a data de pagamento + 1 mês, bloquear a atualização e marcar o pedido para revisão; **NUNCA tentar outro pedido com uma nova chave**. Um crédito do fornecedor já pode ter sido consumido.
- O registro de pagamento ocorre dentro de uma transação PostgreSQL **apenas depois da confirmação real do servidor**, usando a data de recebimento declarada e validada. A transação registra só um débito de crédito e bloqueia pagamentos já lançados após a data original.
- Para um cliente vencido que pagou em 10/11 e vencia em 05/11, o vencimento financeiro esperado é 10/12. Se pagou em 09/11, seria 09/12. Não assumir sempre que a data de processamento é a data do Pix.

## Segurança / rollout
- A ativação geral de vencidos fica **DESLIGADA por padrão**. Exige `PAINEL_RECARGA_OVERDUE_GENERAL_ENABLED=true` como Secret da Edge Function, além dos switches pagos gerais já existentes. Esse Secret NÃO foi criado.
- A integração paga de clientes ainda ativos continua independente, sem alterações de comportamento.
- O piloto individual antigo `PAINEL_RECARGA_HUMBERTO_OVERDUE_ENABLED` continua separado, mas não será necessário criar novos Secrets por cliente.
- A UI lê `generalOverdueEnabled` via `mode:"pilot_targets"`; o servidor valida novamente cliente, pagamento, vencimentos, preço e cobertura antes de enviar ao fornecedor.
- Quando o usuário marca um pagamento como recebido na interface, ainda existe uma **segunda confirmação específica** antes do pedido real.
- Sem flag, toda a implementação geral é inerte e não deve ser usada para produção.

## Ordem única de implantação quando autorizada
1. Concluir revisão técnica, executar CI (testes e `deno check`) e preservar um commit de restauração. Revisar uma cópia/backup dos dados antes de migrações.
2. Aplicar **somente** a migration `supabase/migrations/20261110220000_general_overdue_paid_settlement.sql` ao Lovable Cloud e conferir a função `public.sync_external_renewal_job`. **Nenhum registro de cliente deve ser alterado durante a migration.**
3. Publicar a Edge Function `painel-recarga-renovar` e o módulo compartilhado da MESMA versão GitHub, apenas uma vez.
4. Publicar a interface da mesma versão e confirmar por acesso de proprietário que há diálogo com data de pagamento, preço/custo e confirmação do recebimento.
5. Ativar a flag geral **somente** quando as verificações anteriores passarem. Após ativar, testar UM cliente vencido com pagamento verificado, sem lançamentos duplicados.
6. Verificar no banco: `clients`, `payments`, `server_credit_movements`, `external_renewal_jobs`, data técnica do painel e data financeira correta. Não repetir pedidos pendentes.
7. Se ocorrer divergência, desligar a flag para novos pedidos, manter o histórico e conciliar o pedido existente.

**Não publicar a Edge Function isoladamente antes da migration**. Esse fluxo usa o campo novo `paymentDate`, e o RPC antigo não conserva o dia real do pagamento nem as novas verificações.

## Economia dos créditos do Lovable
- Todas as alterações de código, testes, build e análise devem ocorrer no GitHub e GitHub Actions. O GitHub Actions agora faz `deno check` real da Edge Function, além de testes e build.
- Publicações e configurações no Lovable exigem avaliação prévia de eventual consumo. **NÃO gastar nenhum crédito do Lovable sem autorização específica do proprietário.**
- Para backend **Lovable Cloud**, o Supabase é gerenciado pelo Lovable e não aparece como projeto próprio na conta Supabase. Portanto, o exemplo de GitHub Actions com `SUPABASE_ACCESS_TOKEN` não pode ser assumido como caminho de deploy para o projeto atual.
- Referências:
  - https://supabase.com/kb/troubleshooting/cant-access-supabase-project-lovable-cloud
  - https://supabase.com/docs/guides/functions/examples/github-actions
  - https://supabase.com/changelog/supabase-cli-v3
- Se houver futuramente um projeto Supabase próprio, avaliar publicação de Edge Functions pelo GitHub Actions **somente após migração planejada e validação**, sem publicar ou expor credenciais no repositório.

## Fase atual
- Código preparado; nenhum cliente foi renovado, nenhum pagamento ou crédito da MaxFlix foi alterado por este trabalho.
- Migration adicionada ao GitHub, **não aplicada**.
- Frontend e Edge Function para esse fluxo geral ainda **não publicados**.
- `PAINEL_RECARGA_OVERDUE_GENERAL_ENABLED` ausente/desligado.
