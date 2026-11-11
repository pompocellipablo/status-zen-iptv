# MaxFlix — Renovação de valor zerado e recuperação manual após cancelamento

**Situação: pronta para revisão e CI na branch `feature/zero-active-renewal-manual-fallback`, NÃO publicada em produção.**

## 1. Acesso ATIVO com pagamento do ciclo igual a R$ 0,00

O botão **Renovar no painel** reconhece automaticamente um cliente quando:
- Servidor está na lista homologada (Club, Five, Uniplay, UniP2P, Blade, Now, GF, Fast, All Play; Elite excluído).
- Acesso técnico ainda ativo (vencimento >= data de Brasília), e vencimento financeiro é **igual** ao técnico.
- `paid = 0`; acesso `padrao`, `gratuidade` ou `meu_acesso`.
- Existe custo real de crédito técnico `cost > 0` ou, se o custo atual foi zerado, `prev_cost > 0`.

**Exceções conscientes:** Pacote pré-pago `financial_due_date > due_date` usa a regra normal, sem cobrança nova. Vencidos precisam do fluxo de recebimento e data do pagamento. Clientes sem custo atual nem anterior não podem ser integrados sem acertar o cadastro — não registrar custo R$ 0 fictício. Um `paid=0` isolado não prova gratuidade: antes de qualquer envio, o proprietário marca **"Confirmo expressamente que este acesso ativo deve ser renovado sem cobrança"**. Há uma segunda confirmação individual após o pré-teste sem chamadas externas.

O servidor recebe um único ciclo técnico. A sincronização atômica `sync_external_zero_active_job` exige confirmação externa, preserva `prev_paid`, registra **zero pagamento novo**, atualiza vencimentos e debita exatamente 1 crédito. As datas vêm do servidor após confirmação. A função SQL é idempotente pelo ID do pedido; pedidos duplicados não podem consumir dois créditos locais. O piloto grátis GF anterior continua separado.

O modo geral permanece **desligado por padrão**, protegido por `PAINEL_RECARGA_ZERO_ACTIVE_GENERAL_ENABLED=true` e pelos switches já existentes `PAINEL_RECARGA_ENABLED`, `PAINEL_RECARGA_LIVE_ENABLED`, `PAINEL_RECARGA_ROLLOUT_ENABLED`, `PAINEL_RECARGA_GENERAL_ENABLED`.

## 2. Cancelamento de pedido e recuperação manual

O operador cancela primeiro **o mesmo pedido** diretamente no site do Painel Recarga. A MaxFlix **NÃO faz o cancelamento por API**. Na lista de pedidos, para estados `waiting`, `uncertain` ou `failed` com ID externo conhecido, a MaxFlix oferece **"Já cancelei no Painel Recarga"**, solicitando:
- ID externo do pedido mostrado para conferência
- Observação/protocolo de cancelamento (de 12 a 500 caracteres)
- Texto obrigatório **CANCELADO**
- Declaração explícita de que verificou cancelamento real, sem renovar o acesso

A Edge Function chama a RPC `record_panel_cancelled_for_manual` com autenticação do proprietário. A transação bloqueia o pedido, confere o ID exato, estado, cliente, login, servidor e vencimento, insere trilha `external_renewal_cancellations` e marca pedido `cancelled`. Ela **não** cancela pedido remoto, não renova fornecedor nem altera recebimentos ou créditos. Pedidos `created` sem ID, `synced`, `external_confirmed` e `needs_review` **não** são desbloqueados.

Quando o pedido está `cancelled`, o botão do cliente passa a **"Registrar renovação manual"**. O operador:
1. Renova o cliente **diretamente no servidor**; registra e confere a data técnica nova.
2. Abre a recuperação manual e informa a data observada no servidor.
3. Informa custo técnico e recebimento novo, se houver (pacotes pré-pagos mantêm `R$ 0`).
4. Declara expressamente que já fez a renovação no servidor e, se houver receita, que recebeu o valor e ele ainda não foi lançado na MaxFlix.
5. A MaxFlix só registra pelo RPC manual existente quando a data do servidor corresponde à projeção financeira atual e o pedido continua `cancelled`. Uma divergência bloqueia a alteração e exige conciliação específica.

**Nunca usar "Verificar andamento" num pedido `cancelled` nem reenviá-lo ao Painel Recarga.** Se o fornecedor executou o ciclo apesar do cancelamento, interromper e conciliar antes de qualquer manual.

## 3. Publicação coordenada, economia de créditos

A aplicação usa backend Lovable Cloud. Nenhum trabalho deste branch gasta créditos do Lovable, altera Secrets ou renova clientes. Testes via GitHub Actions incluem Bun, Deno `check` e build.

Ordem de publicação futura (somente após autorização específica para custos):

1. Salvar backup e revisar migrations em ambiente controlado; conferir o fluxo anterior de vencidos que também está pendente.
2. Aplicar migrations nesta ordem: `20261110220000_general_overdue_paid_settlement.sql` (se ainda pendente), `20261111120000_general_zero_active_settlement.sql`, `20261111121000_cancelled_panel_order_manual_recovery.sql`.
3. Publicar `painel-recarga-renovar` junto com `_shared/painel-recarga.ts`, ambos do mesmo commit testado.
4. Publicar frontend `renovacoes.tsx` do mesmo commit.
5. Executar consulta de conferência de existência das RPCs e constraints, e pré-testes read-only do proprietário.
6. Habilitar a flag `PAINEL_RECARGA_ZERO_ACTIVE_GENERAL_ENABLED=true` **somente depois**. Habilitar o modo geral de vencidos separadamente, após revisão.
7. Fazer um teste supervisionado em um cliente ativo com R$ 0,00 e custo técnico válido; conferir `clients`, `payments`, `server_credit_movements`, `external_renewal_jobs` e data do fornecedor.
8. O teste de cancelamento manual deve ser feito apenas quando houver um pedido realmente cancelado, sem gerar pedido artificial.

**A existência de código e migrations no GitHub não significa que estejam ativos em produção.**
