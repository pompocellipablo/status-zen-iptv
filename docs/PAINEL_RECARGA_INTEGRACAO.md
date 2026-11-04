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
- Blade /renovar/iptv/blade
- Club /renovar/iptv/club
- Five /renovar/iptv/five
- GF /renovar/iptv/gf
- Now /renovar/iptv/now
- Uniplay /renovar/iptv/uniplay

Rotas P2P existem para Blade/Five/GF/Uniplay. O proprietário confirmou:
- UniP2P na MaxFlix = Uniplay P2P: /renovar/p2p/uniplay
- Uniplay na MaxFlix = Uniplay IPTV: /renovar/iptv/uniplay

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
