# MaxFlix — ponto de restauração antes da renovação real

Criado em **05/11/2026** para proteger a integração Painel Recarga.

## Ponto estável de código (revisável)

- Branch: `backup/maxflix-antes-renovacao-automatica-2026-11-05`
- Commit: `ebdbb6a1dafc2b0bf8975c7aefdbe3bb43c7bf1d`
- Situação: versão do código com a Edge Function `painel-recarga-renovar` publicada
  anteriormente, antes da lógica que ajusta vencimento técnico conforme
  `vencimento_novo` do fornecedor.
- Repositório original: `pompocellipablo/status-zen-iptv`.
- **Nunca mesclar ou excluir o ramo de backup durante os testes.**
- Configuração obrigatória: `PAINEL_RECARGA_LIVE_ENABLED=false` até nova
  autorização explícita de operação real.
- Restauração do código NÃO implica restauração da base de dados.

## Procedimento se uma nova publicação falhar

1. **Congelar renovações reais** no ambiente de produção:
   `PAINEL_RECARGA_LIVE_ENABLED=false`. Não repetir pedidos com estado
   incerto; reconsultar a mesma `Idempotency-Key` ou conciliar manualmente.
2. Conferir `external_renewal_jobs` e a fila do Painel Recarga. Salvar
   lista dos pedidos com estado `waiting`, `uncertain`,
   `external_confirmed` ou `needs_review`. Um rollback de código não
   cancela as solicitações que já foram recebidas pelo fornecedor.
3. Recuperar **somente os arquivos que falharam** do branch de backup por
   `git restore --source=backup/maxflix-antes-renovacao-automatica-2026-11-05 -- <arquivo>`
   e criar novo commit com testes passando; ou reverter pelo histórico do
   Lovable para a versão correspondente. Evitar dar `reset --hard` no
   `main`: poderia eliminar outras melhorias recentes.
4. Publicar de novo SOMENTE a Edge Function `painel-recarga-renovar`, caso
   o defeito esteja nela. A sincronização GitHub/Lovable do código **não**
   garante republicação automática de uma Edge Function.
5. Conferir `PAINEL_RECARGA_LIVE_ENABLED=false`, funcionamento do login
   e simulação de leitura, sem disparar renovação real.
6. Conferir quantidades atuais de clientes, pagamentos e movimentos de crédito
   sem apagar ou editar os registros. Reconciliar qualquer pedido já concluído
   no fornecedor que não foi registrado no banco da MaxFlix.

## Sobre o banco (proteger separadamente)

- **Código:** versionado no GitHub e no histórico do Lovable.
- **Banco:** dados de clientes, pagamentos e movimentos **não** estão incluídos
  nessa branch. Restaurar um backup total do banco apaga quaisquer registros
  legítimos feitos após o ponto escolhido. Preferir correções transacionais
  individuais, com auditoria, para incidentes de renovação.
- O Lovable Cloud pode disponibilizar backup diário em
  Cloud > Database > Backups; verificar existência e data do backup na
  interface antes de depender dele. Não assumir que um backup foi criado.
- Antes do primeiro piloto real, conferir um backup recuperável, registrar
  a contagem de clientes e o estado da fila externa, e autorizar explicitamente
  qual cliente e qual operação serão testados.
- Não inserir senhas, tokens de fornecedores nem cópias de dados pessoais no
  GitHub. O `PAINEL_RECARGA_TOKEN` permanece somente em secret do backend.

## Critério para permitir um piloto real

- Roteiro de `idempotency` validado e mesmo pedido persistente.
- `vencimento_antes` e `vencimento_novo` tratados no backend.
- Cobertura financeira preservada nos pacotes pagos; um ciclo técnico por vez.
- Mesmo pedido tem no máximo um débito de crédito e um lançamento financeiro.
- Erros e resultados incertos não provocam outro pedido automaticamente.
- Verificação do plano do servidor, do saldo e do vencimento técnico ANTES
  de registrar a operação local; com desvio, bloquear e apresentar revisão.
- Operação real desativada até autorização explícita do usuário.

## Linha de base observada antes do piloto (05/11/2026)

Consulta somente de leitura no Lovable Cloud MaxFlix, útil para auditoria,
**não é uma cópia restaurável dos registros**:

| Registro | Quantidade |
|---|---:|
| Clientes cadastrados | 347 |
| Pagamentos históricos | 320 |
| Movimentos de crédito | 385 |
| Pedidos externos de renovação real | 0 |
| Simulações registradas | 2 |
| Simulações em aberto | 0 |

As quantidades podem mudar com o uso normal do app. Antes de qualquer piloto
real, fazer nova leitura e comparar movimentos do cliente escolhido, não
concluir segurança pela contagem total isoladamente.

## 05/11/2026 — reforço transacional para o piloto (sem ativar renovação real)

- Função `public.sync_external_renewal_job(uuid)` instalada no Lovable Cloud.
  É **aditiva e inerte** até a Edge Function atualizada chamá-la: aguarda
  estado `external_confirmed`, bloqueia por linha o pedido e o cliente,
  registra vencimentos, pagamento (se aplicável), 1 débito de crédito e
  estado `synced` **na mesma transação**. A chamada repetida sobre
  `synced` apenas devolve `alreadyProcessed`.
- `public.renew_client_with_credit` foi atualizado para **bloquear o botão
  manual quando há pedido externo ativo** no mesmo ciclo. Na ausência de
  pedido externo aberto, mantém as regras e parâmetros anteriores.
- O SQL original desse RPC manual está arquivado em
  `docs/ROLLBACK_RPC_MANUAL_ANTES_PILOTO.sql`. Reverter o código do GitHub
  **não restaura essa função no banco**; avaliar e executar o SQL de rollback
  somente após congelar a integração e conciliar todos os pedidos abertos.
- A nova Edge Function de renovação real **ainda não foi publicada** nesta
  etapa. Renovações reais continuam desabilitadas.
- A UI de piloto está atrás de `VITE_MAXFLIX_PANEL_PILOT==="true"`, que
  deve ficar **ausente/false** até liberação expressa do operador. Isso é
  uma segunda proteção além de `PAINEL_RECARGA_LIVE_ENABLED=false` no backend.
- Valores do banco antes/depois das alterações SQL: 347 clientes,
  320 pagamentos, 385 movimentações de crédito, 0 pedidos externos reais.
  Nenhuma renovação/lançamento foi executado nesta etapa.

### Ordem de restauração em incidente do piloto
1. Desabilitar imediatamente `PAINEL_RECARGA_LIVE_ENABLED` e a flag de UI.
2. Consultar a fila do Painel Recarga e os estados de
   `external_renewal_jobs`, inclusive os pedidos `uncertain`.
3. Reverter a Edge Function ao código do branch de backup.
4. **Não** reaplicar o RPC manual anterior se existir pedido externo
   potencialmente executado. Preservar a guarda até resolver cada pedido.
5. Se todos os pedidos estiverem conciliados e a guarda manual causar
   regressão, usar `docs/ROLLBACK_RPC_MANUAL_ANTES_PILOTO.sql` somente após
   nova revisão. A função atômica aditiva pode continuar instalada, pois não
   executa nada sozinha.
6. Comparar pagamentos e movimentos de crédito individuais do(s) cliente(s)
   afetado(s). Nunca apagar lançamentos de todo o sistema para corrigir um.

## Piloto REAL restrito a um único ciclo (Jardel Sabino — Club)

- Selecionado após comparar o acesso técnico com Painel Recarga:
  ambos em `19/11/2026` (05/11/2026).
- O pagamento mensal confirmado pelo operador é R$ 30,00. O banco
  ainda mostrava o último pagamento em 19/10/2026. Verificar novamente
  antes do piloto para evitar duplicar qualquer registro manual posterior.
- A Edge Function do branch principal exige **duas configurações privadas**,
  além da chave geral de live: `PAINEL_RECARGA_PILOT_CLIENT_ID` e
  `PAINEL_RECARGA_PILOT_EXPECTED_DUE_DATE`. Não divulgar UUID ou segredo em
  código, documentação pública ou frontend; configurar via secrets privados.
- Para este piloto, o vencimento autorizado é `2026-11-19`. A função rejeita
  qualquer cliente/ciclo diferente, pacote pré-pago e mais de um mês pago.
- A operação continua desativada até serem feitos **todos** os passos:
  1. Conferir **backup restaurável do banco** no Lovable Cloud.
  2. Confirmar que o cliente ainda não foi renovado técnica ou
     financeiramente em outro dispositivo.
  3. Publicar a Edge Function reforçada e revisar as flags privadas.
  4. Habilitar somente para o cliente permitido e usar confirmação humana.
  5. Verificar a resposta do fornecedor; exigir exatamente um ciclo.
  6. Registrar localmente via RPC atômico, revisar o pagamento único.
  7. Desligar `PAINEL_RECARGA_LIVE_ENABLED` assim que o único pedido for
     conciliado e revisar o estado `external_renewal_jobs`.
- Se a resposta for 202, incerta ou timeout, **não clicar Renovar outra vez**:
  consultar o andamento da mesma chave, pois a fila pode executar ao
  reconectar o servidor.
- A versão segura do piloto está preparada no GitHub, mas **não será
  executada/publicada de forma a renovar clientes sem autorização e backup**.
