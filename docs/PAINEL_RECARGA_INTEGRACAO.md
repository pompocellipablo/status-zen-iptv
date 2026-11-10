# MaxFlix × Painel Recarga — integração de renovações

Documento técnico baseado no PDF "API · Painel Recarga" enviado em 04/11/2026.
**Integração real DESLIGADA até homologação com uma conta de teste.**

## Arquitetura preparada

- Adaptador compartilhado em supabase/functions/_shared/painel-recarga.ts: rotas permitidas e login exato.
- Proxy protegido em supabase/functions/painel-recarga-renovar/index.ts.
- public.external_renewal_jobs: uma chave UUID por cliente e ciclo para evitar duplicidade, com RLS restrita.
- simulate nunca renova; renew e check ficam desativados até configuração de secrets.
- O botão atual da MaxFlix NÃO foi alterado nesta fase.

## Segredos de ambiente (nunca GitHub, console, planilha ou VITE_*)

- PAINEL_RECARGA_TOKEN: gerar em Painel Recarga > Aparelhos > Token à mão.
- PAINEL_RECARGA_ENABLED=true: permitir consulta/simulação no servidor.
- PAINEL_RECARGA_LIVE_ENABLED=true: somente após autorizar e testar o piloto.

O Lovable Cloud já deve prover SUPABASE_URL e SUPABASE_ANON_KEY ou
SUPABASE_PUBLISHABLE_KEY. O JWT é validado e só o proprietário da MaxFlix tem acesso.

## Contrato documentado

Base: https://painelrecarga.dev
Headers: X-Auth-Token, Idempotency-Key UUID, Content-Type application/json.

Rotas IPTV (POST):
- All Play /renovar/iptv/allplay
- Blade IPTV /renovar/iptv/blade (rota da API, não utilizada pelos clientes Blade atuais da MaxFlix)
- Club /renovar/iptv/club
- Five /renovar/iptv/five
- GF /renovar/iptv/gf (documentada pelo fornecedor, mas bloqueada na MaxFlix por falta de acesso habilitado)
- Now /renovar/iptv/now
- Uniplay /renovar/iptv/uniplay

Rotas P2P existem para Blade/Five/GF/Uniplay. O proprietário confirmou:
- Blade na MaxFlix = Blade P2P: /renovar/p2p/blade (confirmado pelo proprietário em 04/11/2026; não há clientes Blade IPTV cadastrados)
- UniP2P na MaxFlix = Uniplay P2P: /renovar/p2p/uniplay
- Uniplay na MaxFlix = Uniplay IPTV: /renovar/iptv/uniplay

GF, Elite e Fast permanecem manuais na MaxFlix; não possuem rota habilitada no adaptador.

Esse mapeamento foi implementado no adaptador com testes para evitar
confundir as duas modalidades. Elite e demais servidores sem mapeamento
continuam manuais. Mesmo com a rota mapeada, simulações e homologação
do resultado do painel são obrigatórias antes de qualquer renovação real.

Corpo de um alvo: usuario (login exato), ciclos:1. Para consulta inclua simular:true.
A API aceita ciclos 1, 3, 6, 12. Importante: UM CICLO É UMA REPETIÇÃO
DO PLANO DO CLIENTE NO PAINEL — NÃO NECESSARIAMENTE UM MÊS.
O vínculo com os vencimentos da MaxFlix deve ser homologado servidor por servidor.

- HTTP 200: verificar global ok, resultados por usuario, ok e incerto.
- HTTP 202: fila, sessão ausente ou confirmação manual; esperar até 24h.
  NÃO atualizar a MaxFlix; consultar com a MESMA Idempotency-Key.
- HTTP 207: lote parcialmente resolvido, requer revisão.
- 400,401,403,404,422: não atualizar localmente.
- Timeout, 5xx ou incerto: nunca assumir sucesso ou gerar outra chave.
- A API recomenda timeout de 130s.

## Fluxo seguro

1. Cliente e servidor são lidos pelo servidor da MaxFlix com JWT válido;
   não aceitar login arbitrário enviado pelo navegador.
2. Simulação com login exato e conferência da validade e do plano.
3. Gerar e persistir idempotency_key ANTES de enviar o pedido real.
4. Enviar somente um alvo. A repetição do mesmo pedido usa chave e corpo idênticos.
5. Se pendente/incerto, manter auditoria, sem atualizar vencimento,
   pagamentos nem créditos na MaxFlix.
6. Se confirmado, validar data de vencimento externa contra data esperada.
   Se houver divergência, suspender sincronização e exigir conciliação.
7. Somente então executar a RPC renew_client_with_credit: data, pagamento e
   crédito local na mesma transação. Marcar job como synced.

## Regras atuais da MaxFlix que devemos preservar

- Pacotes pré-pagos de 6/12 meses são consumidos mensalmente na MaxFlix.
- Meses grátis por indicação têm RPC distinta e precisam de tratamento próprio.
- A sessão no painel pode expirar e retornar 202 mesmo após o usuário clicar.
- GF usa chave configurada em "Chaves e logins"; outros pedem sessão do painel.
- Nenhum pedido real deve ser disparado até validação de token, permissões,
  login, vencimento, crédito, retorno 202 e retry com mesma chave.

## O que falta antes de substituir o botão Renovar

- Token gerado no Painel Recarga e cadastrado como SECRET no projeto Lovable certo.
- Deploy do endpoint no mesmo Lovable Cloud da MaxFlix, não Supabase homônimo.
- Testes simulados sem consumo, seguidos de um piloto real autorizado.
- Comparação real dos vencimentos retornados e regras de ciclo por servidor.
- Painel de pedidos pendentes/incertos e conciliação manual.
- Tratamento das renovações gratuitas por indicação e de pacotes pré-pagos.
- Só depois habilitar fluxo ao clicar no botão principal, sem ação dupla.


## 05/11/2026 — acompanhamento seguro de simulações (PREPARADO, NÃO PUBLICADO)

O desenvolvedor confirmou a regra: **uma nova Idempotency-Key representa uma nova solicitação**.
Se a primeira solicitação ficou aguardando a sessão e foi executada ao reconectar,
reconsultar com uma chave nova pode duplicar o registro de pedido.
O corpo, login, servidor, ciclos e a chave devem ser idênticos na reconsulta.

Mudança preparada no GitHub (não chamar o agente Lovable sem autorização):
- Migração `20261105110000_external_simulation_jobs.sql`: tabela separada das renovações
  financeiras, UUID imutável por solicitação, índice único por cliente com consulta
  aberta e políticas RLS somente para o proprietário.
- `mode=simulate`: reserva o pedido antes de chamar a API. Se já houver consulta
  `created`, `waiting` ou `uncertain`, reutiliza **a mesma chave**;
  não cria outro pedido. Resultado final recente pode vir de cache (até 2 minutos).
- `mode=check_simulation`: verifica a solicitação existente com a mesma chave,
  sem gerar nova. Se já está concluída, devolve o resultado armazenado.
- Resposta `202`, rede indisponível ou estado incerto: preserva a consulta pendente,
  não atualiza vencimentos, pagamento nem créditos.
- Falha no banco de consultas: **falha fechada**, sem enviar pedido ao fornecedor.
- Endpoint `renew`/ `check` de operações reais mantém seu controle independente
  `external_renewal_jobs` e a chave existente por cliente/ciclo.

**Sequência obrigatória na publicação:**
1. Validar GitHub Actions e revisar migration/Edge Function.
2. Aplicar a migração ao Lovable Cloud do projeto MaxFlix CORRETO.
3. Só então publicar a versão atualizada da função `painel-recarga-renovar`.
4. Testar com `simular:true` e uma conta autorizada; na pendência, consultar o
   mesmo pedido, nunca renovar. Não habilitar `PAINEL_RECARGA_LIVE_ENABLED`.
5. Separadamente, atualizar o frontend para apresentar "Verificar andamento"
   e recuperar histórico após recarregar a página (não liberado ainda).

**Não confundir**: preparar código/migration no GitHub não instala a tabela
nem altera a Edge Function em produção. Até a implantação, a tela de auditoria
tem somente bloqueios de pendência temporários e solicitações de simulação
podem seguir gerando novas chaves após recarga. Não repetir manualmente
uma consulta em espera na versão antiga sem conferir a fila.


## 07/11/2026 — preparação do botão único e auditoria aprovada

**Estado:** código e SQL implementados; ativação geral de renovações permanece desabilitada por padrão.

- `Renovar` continua manual para GF, Elite, Fast e para qualquer cliente sem autorização da integração.
- Somente com **ambos** os Secrets privados `PAINEL_RECARGA_LIVE_ENABLED=true` **e** `PAINEL_RECARGA_ROLLOUT_ENABLED=true` o botão único encaminha contas comuns suportadas ao Painel Recarga.
- Publicar a nova Edge Function **não habilita a renovação geral**. Não cadastrar ou ativar o Secret do rollout sem autorização separada.
- O proprietário confirma explicitamente cada operação no navegador; a Edge valida novamente cliente, login, servidor, vencimento esperado, plano, valor e cobertura financeira antes de reservar o pedido.
- Mensal: valor exatamente igual ao cadastro, um crédito/ciclo externo e datas financeiras/técnicas acompanhando a validade do fornecedor.
- Contratação de 6 ou 12 meses: registra um pagamento do pacote, envia somente **um** ciclo técnico externo e calcula a cobertura financeira sem conceder ciclos adicionais no servidor.
- Plano já pago: apenas um ciclo técnico, **zero** pagamento novo, conserva a data financeira; recusa se o acesso técnico superar a cobertura.
- Acessos gratuitos e meses grátis por indicação **não entram no rollout geral**; exigem fluxo próprio, mantendo o piloto gratuito estritamente autorizado separado.
- Pedidos externos criados, pendentes, incertos ou em revisão impedem a renovação manual concorrente. Reconciliar com a mesma chave ou manualmente após evidência do provedor.
- A função já existente de comparação de vencimentos continua usando simulação com login exato e sem alterar cliente automaticamente.
- A aprovação de correção manual agora usa `approve_panel_date_correction`, função de banco com transação e RLS de proprietário, que **preserva o financeiro** e não registra pagamento nem crédito. O histórico permanente fica em `panel_due_date_corrections`, com antiga/nova data, operador e fonte.
- Para fonte de simulação, a função valida a data contra uma consulta autenticada registrada há no máximo 24 horas; para exportação CSV/TXT exige confirmação do proprietário. Em ambos os casos, bloqueia se existir pedido de renovação externo em aberto.
- A correção manual só pode ser aplicada dentro da cobertura financeira já existente. Se o servidor informar validade posterior ao financeiro, exigir revisão financeira separada; não aumentar a cobrança nem a cobertura silenciosamente.

**Pendências antes do uso geral:** publicar a Edge Function, homologar um pagamento real no AllPlay, revalidar um novo contrato mensal, um pacote de 6/12 meses e um ciclo técnico pré-pago; após isso, habilitar os dois switches com consentimento explícito. Não habilitar em massa durante a homologação.

**Recuperação:** código versionado em GitHub, banco contém audit log; alterações ao esquema são aditivas, e nenhum vencimento de cliente foi modificado ao criar a funcionalidade.

## 07/11/2026 — piloto isolado LealPaulo, pacote de 6 meses (preparado, não executado)

Objetivo da homologação: registrar **um único pagamento de R$ 150,00** pelo novo
pacote de 6 meses e **um único crédito técnico no Five**; os cinco ciclos
restantes deverão ser consumidos mensalmente, sem novo pagamento.

As condições deste piloto são deliberadamente mais restritas que as do rollout geral:
- Identificação EXATA do cliente LealPaulo (UUID fixo no módulo servidor),
  servidor Five e vencimento prévio técnico/financeiro 19/11/2026.
- Cadastro esperado: acesso padrão, `paid=0`, `prev_paid=150`, `cost=6.50`.
- Período de 6 meses, receita total R$ 150,00, custo por ciclo R$ 6,50,
  custo financeiro total previsto R$ 39,00.
- Prévia: próximo vencimento técnico 19/12/2026; financeiro 19/05/2027.
  A confirmação real do Five prevalece quanto à data técnica; divergências
  no vencimento anterior ou projeções improváveis impedem sincronização automática.
- A ação real continua exigindo pré-validação, segundo clique de confirmação,
  permissão do proprietário, registro de job idempotente e
  `PAINEL_RECARGA_LIVE_ENABLED=true`.
- Chave **separada**, por padrão ausente/desligada:
  `PAINEL_RECARGA_LEALPAULO_6M_ENABLED=true`. Sem ela, esta autorização
  NÃO é exposta por `pilot_targets` nem aceita pela Edge Function.
- `PAINEL_RECARGA_ROLLOUT_ENABLED` permanece desligada. Não usar esse
  switch geral para executar o piloto individual.
- A chave nova é apenas uma permissão para o cliente específico e
  não contém token do fornecedor; não incluí-la como `VITE_*`.
- Para homologar, publicar exclusivamente a Edge Function com o código e o
  módulo compartilhado, configurar somente a chave individual e manter o
  switch live desligado até autorização explícita para uma operação real.
- **Não registrar pagamento manual antes da conclusão**, para evitar duplicidade.
  A RPC `sync_external_renewal_job` registra uma única receita após confirmação
  do fornecedor, debita um crédito local e preserva a cobertura financeira.
- Se o fornecedor retornar 202, 207, timeout, outra data de início ou resultado
  incerto, não abrir novo pedido: acompanhar a **mesma idempotency key** e
  conciliar antes de retentar ou registrar pagamento.


## 08/11/2026 — novas APIs informadas: GF e Fast

O proprietário informou ter incluído as APIs de GF e Fast no Painel Recarga.

- **GF IPTV**: a rota `/renovar/iptv/gf` já era documentada. Foi adicionada
  ao adaptador compartilhado e coberta por teste unitário; isso NÃO autoriza
  renovação real. Antes de homologar, confirmar login exato, validade técnica,
  modalidade IPTV e resposta de consulta, sem descontar créditos.
- **Fast**: ainda não consta no contrato de rotas recebido. Preservar Fast
  como manual até confirmar na documentação atualizada do Painel Recarga
  o endpoint e se a modalidade é IPTV ou P2P. NÃO supor
  `/renovar/iptv/fast` sem documentação.
- Nenhuma configuração de secrets, rollout ou cliente é alterada nesta etapa.
  A Edge Function vigente conserva a autorização exclusiva expirada do
  LealPaulo, portanto novo tráfego real permanece bloqueado.
- Próxima etapa: homologação de simulação não consumidora, conferência
  do ciclo/retorno, seguida de um único piloto real separado e expressamente
  autorizado. Não utilizar clientes não pagos para testes com consumo.


## 08/11/2026 — Fast IPTV confirmado na API

O proprietário enviou uma captura do próprio Painel Recarga mostrando o endpoint
**POST `/renovar/iptv/fast`**, com alternativa `/renovar/fast`, e
indicando que Fast **usa a chave cadastrada em Chaves e logins**.
A captura mostra também a seção de GF, com o mesmo mecanismo de chave.
Nenhuma chave ou token deve ser registrado no GitHub ou neste documento.

**Estado atualizado do adaptador:**
- `Fast` → IPTV, `/renovar/iptv/fast` (mapeamento exato)
- `GF` → IPTV, `/renovar/iptv/gf` (rota já documentada e mapeada)
- Ambos permanecem SEM homologação real e SEM liberação de renovação.
- A lista privada `PANEL_PILOT_BATCH_SERVERS` não foi ampliada: Fast
  e GF continuam excluídos dos pilotos anteriores.
- A Edge Function de produção ainda exige autorização exclusiva de
  cliente/ciclo, e a janela anterior do LealPaulo expirou. Adicionar
  a rota ao código não permite renovar outros clientes.
- Próxima fase: publicar o adaptador com restrições intactas,
  validar a modalidade e o login exato por simulação sem consumo
  (verificando se a chave está conectada no Painel Recarga).
  Somente após resultado aprovado, selecionar um cliente real
  efetivamente pago, requerer confirmação explícita e autorizar um
  piloto limitado para cada servidor. Não acionar POST de renovação real
  ou criar pagamentos apenas para testar a rota.


## 10/11/2026 — liberação controlada implementada (DESLIGADA)

O código deixou de depender exclusivamente do piloto LealPaulo (cuja janela
se encerrou em 07/11/2026). A nova rota de renovação real exige **três
autorizações simultâneas no backend**:

- `PAINEL_RECARGA_LIVE_ENABLED=true`, autorização geral para tráfego real;
- `PAINEL_RECARGA_ROLLOUT_ENABLED=true`, autorização separada de rollout;
- `PAINEL_RECARGA_ROLLOUT_TARGETS`, JSON privado e válido, com 1 a 8 objetos
  exatos do formato `{"clientId":"UUID","server":"Club","expectedDueDate":"AAAA-MM-DD"}`.

O token principal `PAINEL_RECARGA_TOKEN` e
`PAINEL_RECARGA_ENABLED=true` continuam necessários. A lista aceita
somente Club, Five, Uniplay IPTV (`Uniplay`), UniP2P, Blade ou Now.
**GF, Fast, All Play e Elite ficam excluídos** até a homologação específica.
Não colocar segredos nem configurações reais da lista no GitHub.

A autorização depende simultaneamente de **ID, servidor e data técnica
anterior**. O próximo vencimento muda depois de renovar e a autorização
antiga deixa de servir automaticamente. Listas ausentes, grandes,
duplicadas, malformadas ou com servidores não homologados são recusadas.

A consulta `pilot_targets` é autenticada, restrita ao proprietário e
somente de leitura. Mostra apenas autorizações habilitadas; não gera pedido,
não grava pagamentos e não revela token do fornecedor. O botão da
MaxFlix fica integrado apenas para esses clientes; cada tentativa passa
por pré-validação e confirmação explícita no navegador, e o backend
revalida todas as condições antes de usar um crédito técnico.

**Nenhum secret foi ativado nesta implementação; não foram feitas
renovações reais.** Antes do primeiro uso, publicar a Edge Function com as
proteções, conferir `pilot_targets` com integração desligada, homologar
um cliente pagante específico e obter nova autorização explícita para o
pedido real.

**Limitação conhecida:** clientes vencidos têm `paid/cost` frequentemente
zerados pelo processo de baixa; não podem usar o rollout inicial como
se os valores históricos fossem um pagamento novo. Adequar esse fluxo
com validação própria antes de liberar vencidos. Acessos gratuitos,
gratificações por indicação e servidores não homologados continuam fora.

## 10/11/2026 — primeiro piloto real proposto na GF (AINDA NÃO HABILITADO)

O proprietário selecionou **EwertonWp** (GF) para a primeira homologação real.
O cadastro técnico e financeiro atual vence em 19/11/2026, mensalidade
R$ 30,00 e custo por ciclo R$ 6,00. Último pagamento lançado: 19/10/2026;
nenhum novo pagamento deve ser criado só para testar.

A inclusão de `GF` na lista de servidores elegíveis é **apenas
capacidade técnica**. Não ativa a renovação de nenhum cliente. Continua
obrigatório autorizar o cliente/ciclo pelo Secret privado
`PAINEL_RECARGA_ROLLOUT_TARGETS`, com ID, servidor e vencimento exatos,
além dos switches `PAINEL_RECARGA_ROLLOUT_ENABLED` e
`PAINEL_RECARGA_LIVE_ENABLED` (ambos desligados por padrão).

**Antes de habilitar:** publicar a Edge Function de produção, consultar
o login `EwertonWp` na simulação (sem consumo) e verificar que a validade
no painel é 19/11/2026. Confirmar recebimento real da nova mensalidade;
não atualizar o cliente nem lançar o pagamento antecipadamente. Só depois
habilitar a autorização exclusiva e clicar em "Renovar no painel",
acompanhando o pedido único e a sincronização. Se a simulação divergir,
interromper o piloto e conciliar as datas sem consumir um crédito.


## 10/11/2026 — operação diária por servidores homologados (preparada; desligada por padrão)

Além dos pilotos por cliente exato, o backend e a UI passam a aceitar um
segundo modo de liberação **geral, porém restrita**, exclusivamente
para Club, Five, Uniplay IPTV (`Uniplay`), UniP2P, Blade, Now e GF.
Fast, All Play e Elite NÃO entram.

Para ativar esse segundo modo, é obrigatório um NOVO Secret privado
`PAINEL_RECARGA_GENERAL_ENABLED=true`, além dos dois switches
`PAINEL_RECARGA_LIVE_ENABLED=true` e
`PAINEL_RECARGA_ROLLOUT_ENABLED=true`. Na ausência do novo Secret, tudo
permanece como no piloto anterior. Um switch desativado bloqueia novas
renovações reais. O usuário continua confirmando cada cliente/ciclo.

A liberação geral cobre apenas clientes ativos, com custo técnico positivo,
acessos padrão ou pacote pago e dados de vencimento consistentes:
mensal com valor de pagamento positivo já cadastrado OU ciclo técnico
completamente coberto por pagamento prévio. O servidor é fonte de verdade
da validade técnica confirmada; as regras financeiras permanecem no banco.
Contas vencidas, gratuitas, meses de indicação pendentes e novas vendas
de planos semestral/anual ficam fora do rollout geral nesta fase.
Não é permitido reprocessar o mesmo ciclo ou alterar a data financeira
do pacote já pago. O botão continua distinguindo renovação integrada
da renovação manual em acessos não elegíveis.

Não disponibilizar o modo geral em produção até publicar e verificar
**ambas** as versões: front-end e função backend, confirmar testes
estáticos/de tipagem e então configurar a chave nova. Nenhum clique
de renovação será executado pela implantação em si.
