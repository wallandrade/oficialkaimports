# Regras de negócio — KA Imports

> **Última atualização:** 2026-08-26  
> Descreve o que *já existe no código*; não especular.

## Changelog

| Data | O quê | Impacto | O que NÃO mudou |
|------|--------|---------|-----------------|
| 2026-08-26 | Espelho Motoboy da Yury (pull + webhook HMAC) | Cobertura de bairro/CEP sincronizada | Agenda, estoque e last-mile inalterados |
| 2026-08-26 | Motoboy: whitelist de SKUs, dois limiares de frete grátis, lookup de bairro com `(…)`, `intervalHours` no bairro, cópia com PIX pendente, expire libera slot | Checkout e operação alinhados à Yury | Sem portal do rider, sem pool de estoque, sem timeline last-mile |
| 2026-08-24 | Sync também atualiza entregues sem cidade no histórico | Minha conta mostra location após sync | Pedidos já com cidade não reconsultam |
| 2026-08-24 | Parser de rastreio EE grava cidade (`location.name` / `city_name` / município) | Timeline mostra “Cidade - unidade” | Status e Sync iguais |
| 2026-08-24 | Meus pedidos: timeline de rastreio igual à do painel EE (bolinha/linha) | Status técnico + data; Situação continua traduzida | Sync/webhook inalterados |
| 2026-08-24 | Rastreios EE: clique em Status ordena a lista (A–Z / Z–A) | Agrupa o mesmo status; 3º clique volta à data | Timeline e Sync iguais |
| 2026-08-24 | Rastreios EE: clique na linha abre timeline do JSON do pedido | Sem chamar a API no clique; Sync continua atualizando | Cotar/criar/etiqueta inalterados |
| 2026-08-21 | Filho de reenvio de suporte nasce com venda/custo; desconto na edição | Cópia mostra subtotal/total; status aguardando pagamento | PIX, estoque e EnvioEcom inalterados |
| 2026-08-21 | Busca de pedidos com debounce 300ms; data não recarrega o dashboard | Digitação e troca de data mais rápidas | Filtro local e período da API iguais |
| 2026-08-21 | Lista admin omite comprovante/etiqueta em `data:` + OCR | JSON menor; clique hidrata `GET :id` | Upload/gravação de comprovante iguais |
| 2026-08-20 | **Envios 48h** (e 72/96h, motoboy, outros) exclui pedidos **Procurando produto** | Esses pedidos só saem no botão Procurando produtos | Compra 48h e fila de alocação inalteradas |
| 2026-08-20 | Pedidos para enviar: botão **Procurando produtos** copia só os cards com a flag | Lista operacional só desses pedidos | Compra/Envios 48h inalterados |
| 2026-08-20 | Flag manual **Procurando produto** no card (`is_procurando_produto`) | Selo + aviso nas cópias; não mistura com estoque | Estoque / Faltando estoque / PIX / EnvioEcom inalterados |
| 2026-08-18 | Extrato: vários PIX no mesmo pedido (`order_bank_deposits`) | Soma no card; 2º PIX não substitui o 1º | Match automático valor igual; `paid` inalterado |
| 2026-08-18 | Extrato: Vincular com valor ≠ pede motivo e grava em `orders.observation` | Modal só no vínculo manual | Match automático / Aplicar 100% exigem valor igual; `paid` inalterado |
| 2026-08-18 | Extrato: **Buscar no extrato** vincula PIX ao nº do pedido (mesmo com nome diferente) | Religa FITID; valor precisa bater | Match automático e pago iguais |
| 2026-08-18 | Extrato: clique no pedido amplia datas; título **Valor bateu, nome diferente** + hints | Pedido antigo aparece na lista; labels em pt-BR | Analyze/apply iguais |
| 2026-08-18 | Extrato: CPF/CNPJ no OFX = score **100%** se igual `clientDocument` | Confirma pagador pelo documento mesmo com nome diferente | Valor/janela/FITID iguais |
| 2026-08-18 | Extrato: **Aplicar este** por linha (outros/100%/ambíguo) | Confirma depósito um a um sem lote | Apply em massa e Desfazer iguais |
| 2026-08-18 | Aba Depósitos: **Desfazer** por linha (`POST .../clear`) | Remove vínculo depósito; FITID volta no Extrato | Status pago / Extrato apply iguais |
| 2026-08-18 | OFX v2: só Inter manual; FITID já salvo ignorado; aba Depósitos persistente | Extrato some no F5; histórico em Depósitos; badge “Depósito pago 100%” | Webhook PIX, paid e comprovante PDF inalterados |
| 2026-08-18 | Extrato OFX do Inter concilia PIX com pedidos (flag `bank_deposit_*`) | Aba Extrato + badge Depósito 100%; não marca pago | Webhook PIX e comprovante PDF inalterados |
| 2026-08-17 | Pedido enviado/coletado deixa de ficar como prioridade | Zera `is_prioridade`; card não mostra a estrela | SLA automático e botão em pedidos não enviados inalterados |
| 2026-08-17 | Salvar custo do produto preenche pedidos com custo 0/ausente; card trata 0 como sem snapshot | Lucro est. passa a descontar o custo novo nesses pedidos | Pedidos com custo > 0 antigos (>24h) inalterados |
| 2026-08-17 | Vincular EE cola envio externo (ID ou rastreio) no pedido | Card ganha shipment_id/status; webhook/sync usam esses IDs | Cotar/criar envio inalterados |
| 2026-08-16 | Comprovante PDF no admin abre (blob + CSP `frame-src`) | Clique no selo PDF mostra o arquivo | Upload/gravação `proofUrls` inalterados |
| 2026-08-16 | Admin pode cancelar reenvio ativo (`reenvio_cancelado`) | Some da fila; pedido original/`enviado` iguais | Estoque só baixa em “Marcar Reenvio Enviado” |
| 2026-08-16 | Saldo atual por produto lista estoque positivo primeiro | Busca continua por nome; zeros no fim | API de inventário inalterada |
| 2026-08-16 | Histórico de rastreio na Minha conta mostra o evento mais recente no topo | Ordena por data, não `.reverse()` cego | API/BD do histórico inalterados |
| 2026-08-16 | Minha conta traduz status EnvioEcom (etiqueta/pronto) para “Estamos embalando seu pedido” | Só UI do cliente; hint de despacho | Admin/BD continuam com o status técnico |
| 2026-08-16 | Clique na foto do saldo de estoque abre zoom (lightbox) | Identificar embalagem sem sair da lista | API de inventário inalterada |
| 2026-08-16 | Busca de produto em Estoque/Reenvios mostra foto (não usa mais `datalist`) | Igual ao saldo; clique escolhe o item | API de entrada/saída inalterada |
| 2026-08-16 | Minha conta mostra `orderNumber` (#1831), não o UUID | Card e WhatsApp de suporte iguais ao admin | Rotas `/api/me/orders/:id` continuam com `id` |
| 2026-08-16 | Create EnvioEcom recusa CPF/telefone/e-mail inválidos no pedido (não envia CPF `000.000.000-00`) | Toast e log mostram o motivo | Cotação continua só com CEP/caixa |
| 2026-08-15 | Editar pedido grava telefone, e-mail e CPF além de nome/endereço/itens/desconto | Contato do pedido muda no card e nas cópias | Frete/seguro continuam do checkout; conta `customer_users` inalterada |
| 2026-08-15 | Admin da filial edita os pedidos da própria loja (botão não exige mais `isPrimary`) | Pedidos continuam isolados por tenant | Loja 1 e filial não veem os pedidos uma da outra |
| 2026-08-15 | Etiqueta EnvioEcom não volta a “Pendente”: aborta GET velho, grava “Etiqueta emitida” e preserva PDF na lista | Card fica Pronto para envio até coleta/cancelamento | `enviado` continua só na coleta |
| 2026-08-15 | Timeline EnvioEcom no card de Meus pedidos (status + cidade; sync/poll) | Cliente vê o mesmo histórico da consulta à API | Modal de rastreio deixou de ser obrigatório |
| 2026-08-15 | WhatsApp de checkout usa `orderNumber` (ex. #1841), não o UUID | Mensagem e toast iguais ao admin | Link KYC continua `/kyc/:id` interno |
| 2026-08-14 | Busca só dígitos no admin casa apenas o código do pedido | Evita #1756 aparecer ao buscar 1813 via telefone/CEP | Nome/e-mail/produto continuam no texto livre |
| 2026-08-14 | Aba Rastreios EE com KPIs/grupos/sync lote e link do pedido | Painel de envios vinculados no BD | Cotar/criar etiqueta inalterados |
| 2026-08-13 | Cotação EnvioEcom padrão 2×12×17 / 0,3 kg / R$ 5 (não total do pedido) | Frete alinhado ao simulador | Checkout e motoboy inalterados |
| 2026-08-13 | Busca de pedidos no admin: dígitos casam `orderNumber` exato antes de nome/telefone/CEP | Número tipo 1813 não mistura com telefone | Texto da busca continua só no frontend; período de datas na API |
| 2026-08-13 | `enviado` só na coleta/postagem EnvioEcom, não na geração da etiqueta | Card fica Pronto para envio até webhook/sync de coletado | Fila 48h continua saindo na etiqueta |
| 2026-08-13 | Card EE com etiqueta: badge Pronto para envio + Faltando estoque; some de Pedidos para enviar sem forçar `enviado` | Cópia/fila não recompra; estoque continua visível | `enviado=true` ainda exige baixa de estoque |
| 2026-08-13 | Etiqueta EnvioEcom pronta sai da fila 48/72/96h mesmo com estoque faltando | Libera vaga de expedição; `enviado` continua exigindo estoque | Motoboy/retirada e OCR manual |
| 2026-08-13 | EnvioEcom no admin de cada loja/filial; `enviado` na etiqueta pronta; rastreio na conta do cliente | Pedidos padrão podem ser despachados pela API EnvioEcom | Motoboy/retirada e OCR de etiqueta manual continuam; checkout não cota EnvioEcom |
| 2026-08-11 | Política de sync: memória incrementada pelo agente após mudanças relevantes | Menos divergência e menos erros repetidos | Regras de negócio de runtime inalteradas |
| 2026-08-11 | Criação inicial a partir do código | Baseline para agentes | Nenhuma regra de runtime alterada |

## Precedência

1. Código-fonte atual  
2. Esta memória viva  
3. Suposições do agente  

Se memória ≠ código → seguir o código e **atualizar esta memória** (changelog + corpo) na mesma tarefa, salvo mudança sem impacto de contexto.

---

## Domínio do produto

- E-commerce multi-tenant (loja + filiais) com catálogo, carrinho, checkout, PIX/cartão, admin, vendedores, afiliados, rifas, estoque e logística.
- Tenant padrão: `tenant_loja1` (`artifacts/api-server/src/lib/tenant-context.ts`).

## Pedidos e pagamento

- Fluxo PIX preferencial: `POST /api/checkout/pix` cria pedido + cobrança no gateway (`artifacts/api-server/src/routes/checkout.ts`).
- Status observados no código: `pending`, `awaiting_payment`, `paid`, `cancelled` (e fluxos admin de marcação manual).
- Confirmação PIX: **via webhook** (`POST /api/webhook/pix`). Job de reconciliação **não** faz polling de status no gateway — só expira pedidos/cobranças `pending`/`awaiting_payment` > 24h (`artifacts/api-server/src/reconciliation.ts`).
- **Extrato OFX (Banco Inter):** aba **Extrato** sobe `.ofx`, analisa só créditos (`TRNAMT > 0`) e cruza valor exato + janela de data + score de nome. Se o CPF (11) ou CNPJ (14) do pedido aparecer nos dígitos de `NAME`/`MEMO` do crédito, o score vira **100%** mesmo com nome diferente. Só pedidos de **depósito Inter manual** (`whatsapp_pix`, ou PIX **sem** `transactionId`); PIX gateway (CNPay/DentPeg com `transactionId`), cartão simulado e crédito de afiliado ficam de fora. FITID já gravado em `ok`/`confirmed_100` é ignorado no próximo OFX (não 400 se todos já estiverem registrados). **Aplicar só 100%** grava `confirmed_100` no pedido (`bank_deposit_*` + FITID único). Um pedido pode ter **vários PIX** (`order_bank_deposits`); `orders.bank_deposit_amount` é a soma. O 2º PIX não desfaz o 1º. Motivo só se a soma ainda ≠ total. **Desfazer** na aba Depósitos remove um PIX (`POST /api/admin/bank-statement/clear` com `fitid`) sem mudar `paid`. Não baixa PDF/comprovante, não fala com o gateway. Conta mascarada. Seller-scoped só vê/aplica/desfaz nos próprios pedidos. O relatório da sessão some no F5; o histórico persistente é a aba **Depósitos**.
- PIX dura ~15 min no gateway (`PIX_DURATION_MS` em `gateway.ts`); regeneração/expiração tratada nas rotas PIX/checkout.
- Cartão: pedido + fluxo KYC (`/kyc`, `/kyc/:orderId`); parcelas e comunicação WhatsApp no admin/FE.
- Finalizar no WhatsApp (`whatsapp_pix`): `POST /api/orders` devolve `orderNumber`; a mensagem usa `Pedido: #1841` (número sequencial), não o `id` UUID. Link KYC de cartão continua com o `id`.
- Cupons: % ou valor fixo, min. pedido, max usos, ativo/inativo.
- Seguro de frete e opções de frete (incl. motoboy com data/hora) existem no schema de pedidos e rotas de shipping/logística.
- Motoboy no checkout: setting `motoboy_eligible_product_ids` (JSON; vazio = todos). Carrinho misto some a opção; API `400 MOTOBOY_NOT_ELIGIBLE`. Frete grátis Motoboy usa `checkout_free_shipping_min_motoboy`, separado de `checkout_free_shipping_min_subtotal`. Lookup de bairro normaliza acento, tira `(…)` e espaços; senão faixa CEP mais estreita. Duração do slot = `interval_hours` do bairro/faixa (não mais preço ≤ 75). Cópia Motoboy (N) inclui PIX pendente, sem telefone; Procurando produto continua fora. Job de expire 24h cancela o pedido **e** apaga a reserva. Após 18h (SP) o calendário começa amanhã. Cliente vê data/hora na Minha conta e no Success. Isolamento EnvioEcom inalterado. Sem portal de preço e sem pool de estoque Motoboy. **Cobertura (bairros/faixas)** é espelho da Yury quando `YURY_MOTOBOY_SYNC_TOKEN` está setado (pull 15 min + webhook HMAC); cadastro local de cobertura fica bloqueado.
- EnvioEcom (loja 1 e filiais, admin com `hasGlobalAccess`): cotar/criar envio/gerar etiqueta PDF/webhook. Não se aplica a motoboy/retirada. Frete cobrado do cliente no checkout **não** é a cotação EnvioEcom. Cotação padrão: 1 pacote 2×12×17 cm, 0,3 kg, R$ 5. No create, `items[].name` é o setting da loja (`envioecom_shipment_item_name`, default Mercadoria), nunca o nome do produto. Create exige CPF/CNPJ (11/14 dígitos, não só zeros), telefone com DDD e e-mail com `@`; senão 400 `INVALID_RECIPIENT` sem chamar a EnvioEcom.
- Marcar `enviado` só quando o status EnvioEcom indicar coleta/postagem/trânsito (`coletado`, `postado`, `em transito`, `saiu para entrega`, `entregue`), via `ensureOrderMarkedEnviado`. Gerar etiqueta / DC-e / “Pronto para envio” **não** seta `enviado`: o card fica **Pronto para envio**, sai da fila 48/72/96h e de “Pedidos para enviar”, e a vaga vai para `shipped`. Se faltar estoque na coleta, `enviado` permanece false e **Faltando estoque** continua. Status “Entregue” pode promover pedido para `completed` se não estiver cancelado. Status **Cancelado** na EnvioEcom remove **Pronto para envio** (mesmo com PDF) e, se ainda não estiver `enviado`, devolve o pedido à fila 48/72/96h. Gerar PDF grava status **Etiqueta emitida** se ainda for “Envio criado”; o admin aborta GET atrasado e não apaga `envioecomLabelUrl` local — o card não volta a **Pendente para envio**.
- Crédito de afiliado pode zerar o valor a pagar (`paymentMethod: affiliate_credit`, `status: paid` quando `payableAmount <= 0`).

## Catálogo

- Fonte principal: tabela `products` (MySQL/Drizzle).
- Fallback documentado no código: Google Sheets se DB vazio (`products.ts`).
- Flags: `isActive`, `isSoldOut`, `isLaunch`, promo com `promoPrice`/`promoEndsAt`, desconto por volume (`bulkDiscountTiers`), variantes (`variantGroups`).
- Imagens: URL pública R2/CDN; base64 legado ainda suportado na migração.
- Checkout grava `costPrice` no item do pedido (snapshot; `0` se a ficha ainda não tinha custo). Ao **salvar** um custo novo no produto: pedidos das **últimas 24h** da loja com aquele item são sobrescritos; pedidos mais antigos **só** recebem o custo se o item ainda estiver `0`/ausente. O **Lucro est.** do card (e o dashboard) trata `0` como sem snapshot e cai no custo atual da ficha até o backfill gravar.

## Multi-tenant e filiais

- Resolução pública de tenant por domínio HTTP (`resolvePublicTenantId`).
- Isolamento por `tenantId` em pedidos, produtos, settings, etc.; legado null/vazio tratado como loja1 em vários `build*TenantWhere`.
- Sync de produtos loja1 → filial e filas de compra filial existem (`tenant-product-sync`, `filial-purchases`, `filial-purchase-queue`).
- Smoke tests de isolamento: `scripts/SMOKE_TESTS.md`, `scripts/src/smoke-tenant-isolation*.ts`.

## Vendedores vs afiliados

- **Seller**: slug em `sellers`, link `/:seller`, comissão (`commissionRate`, snapshot no pedido).
- **Afiliado**: `affiliates` + crédito/comissões; short link `/r/:code` no FE.
- Não tratar seller e afiliado como a mesma entidade.

## Admin

- Auth própria (sessão/cookie); escopo `isPrimary` / seller-scoped / tenant (`admin-auth.ts`, `admin_user_tenants`).
- Primary-only em vários endpoints (tenants, tracking live, etc. — ver `requirePrimaryAdmin`).
- Cobranças custom (`custom_charges`), comprovantes múltiplos (`proofUrls`), edição de pedido: primary da loja 1 e admin de filial nos pedidos do próprio tenant (seller-scoped não edita). O PATCH grava nome, telefone, e-mail, CPF, endereço, produtos e desconto; CEP no modal preenche ViaCEP ao sair do campo. Frete e seguro não são editáveis nesse modal. Não atualiza `customer_users`. Comprovante PDF no modal do admin converte `data:` para blob (`frame-src blob:` no CSP).
- Busca de Pedidos é só no frontend (`search` → `filteredOrders`), com debounce de 300ms no input (a lista só filtra quando a digitação para). Data/status/método/vendedor/grupo vão na API; mudar a data **não** recarrega o dashboard de estatísticas (ele tem data própria). Só dígitos: **somente** `orderNumber`/id do pedido (não telefone/CEP). Senão `includes` em id, número, nome, telefone, e-mail, CEP e produtos. Fora do período carregado não aparece. Clique no nº a partir do Extrato/Depósitos chama `goToOrder`: amplia o intervalo de datas e zera status/método. A lista `GET /admin/orders` não manda comprovante/etiqueta em `data:` nem texto de OCR; `GET /admin/orders/:id` carrega na hora de ver o comprovante.
- **Prioridade** no card: botão grava `is_prioridade`; SLA automático (48h úteis, pago/concluído, ainda não enviado). Ao marcar **enviado** (botão, rastreio ou coleta/postagem EnvioEcom) a prioridade manual é zerada e o selo some. Pedido já enviado não mostra nem deixa ligar a estrela.
- **Procurando produto** no card: botão grava `is_procurando_produto` (PATCH `/api/admin/orders/:id/procurando-produto`). Liga/desliga à mão; persiste no BD (não some no F5). O card ganha anel amarelo nas laterais (como a prioridade vermelha); o fundo continua normal. Nas cópias (resumo, completo, lista de expedição/fornecedor, motoboy) entra: `NÃO FAZER ETIQUETA AINDA — atrasados para achar o produto do cliente.` Em **Pedidos para enviar**, o botão **Procurando produtos (N)** aparece só se `N > 0` e copia **somente** esses pedidos. **Envios 48h/72h/96h**, Motoboy e Outros **não** incluem os marcados (o contador do Envios também cai). **Compra 48h** continua com todos os pedidos do lote. Não mistura com o badge automático **Faltando estoque**. Não bloqueia a API da EnvioEcom; é aviso operacional. Mensagem de pós-pagamento para o cliente não inclui o aviso. Desligar remove o anel e o texto e o pedido volta ao Envios.
- Aba **Rastreios EE**: lista pedidos com barcode/shipment_id/status EnvioEcom; Atualizar lista lê o BD; Sync consulta a API. Clique na linha abre/fecha a timeline (`envioecom_status_history`, mais recente em cima); Sync/PDF/Pedido não fecham a linha. Clique no cabeçalho **Status** ordena A–Z, depois Z–A, depois volta à ordem por data. Campo “Nome do produto no create” (até 120 chars) vale para todos os itens da loja; envios já criados não mudam. **Vincular EE** cola ID ou rastreio de um envio já criado no painel EnvioEcom no pedido (não cotação/create).
- Aba **Extrato**: upload OFX → Analisar → relatório (100% / **Valor bateu, nome diferente** / ambíguos / PIX sem pedido / pedido sem depósito) → aplicar em lote ou **Aplicar este** por linha (grava `ok` nos outros; `confirmed_100` nos 100%; ambíguo depois de escolher o pedido). **Buscar no extrato**: filtra PIX por nome/valor/FITID e **Vincular** ao nº do pedido (`clear` se o FITID já estiver em *outro* pedido). Valor igual ou soma que fecha o total aplica direto; se a soma ainda ≠ total, abre modal de motivo. Vários PIX no mesmo pedido (ex. edição). Clique no nº do pedido abre Pedidos ampliando `dateFrom`/`dateTo` (data do pedido → hoje, ou 365 dias). Meta mostra créditos novos, FITIDs já registrados (ignorados) e pedidos manuais vs. total no período. Badge no card: **Depósito pago 100%** / Depósito OK / **Depósito parcial** (soma < total) / Depósito não encontrado.
- Aba **Depósitos**: `GET /api/admin/bank-deposits` lista cada PIX aplicado (`confirmed_100` / `ok` / ambos). Não some ao atualizar. Clique no pedido abre o card em Pedidos. **Desfazer** remove aquele FITID; os outros PIX do pedido ficam.

## KYC

- Obrigatório no fluxo de cartão (aviso + envio de docs).
- Tabela `kyc_documents`; APIs públicas e admin em `routes/kyc.ts`.

## Estoque / reenvios / logística

- Saldos e movimentos (`inventory_*`); entradas admin em `reshipments.ts`. Busca de produto na entrada, reenvio manual e “produto voltando” mostra a foto do catálogo (mesmo thumbnail do saldo). No **Saldo atual por produto**, clicar na miniatura abre a foto em zoom (Esc ou clique fora fecha). A lista mostra saldo **positivo primeiro**, depois 0, e dentro de cada grupo ordena por nome.
- Reenvios manuais/automáticos, retornos, alocações de logística, reservas motoboy (CEP/bairros). Status: aguardando estoque, pronto para envio, enviado, resolvido sem entrada, **cancelado**. No card do pedido ativo há **Cancelar Reenvio** (confirmação); some da fila “para enviar” e não dá baixa de estoque. “Cancelar Reenvio Enviado” continua só desfazendo o enviado. Pedido/`enviado` do envio original não mudam. Pedido filho de suporte (`REENVIO DO PEDIDO` na observação) nasce com **preço de venda e custo** nos itens e `subtotal`/`total` da venda (frete/seguro 0). Status `awaiting_payment` e `paidAmount` 0 — o admin aplica o desconto em **Editar pedido** (Cupom / Desconto) para o cliente pagar o custo. Comissão nova só se houver acréscimo de qtd (`sellerCommissionRateSnapshot` > 0); reposição fica snapshot `0` (selo Sem nova comissão). A cópia completa usa os preços dos itens se o total gravado for 0 (pedidos antigos) e imprime a linha de Desconto. Resumo financeiro ainda ignora custo de filho antigo com total 0.
- Fila 48/72/96h só conta alocações `allocated`. Pedido com PDF EnvioEcom ou status de etiqueta/trânsito não volta para `allocated` no reconcile só porque `enviado` ainda é false. Exceção: status EnvioEcom **Cancelado** (e ainda não `enviado`) devolve à fila.

## Rifas

- Tabelas `raffles`, `raffle_reservations`, `raffle_results`, `raffle_promotions`.
- Job de expiração: `raffle-expiry.ts`.
- Páginas FE: `/rifas`, `/rifas/:id`, `/rifas/pix/:id`, `/rifas/consulta`.

## Cliente final

- Conta: `/login`, `/minha-conta/pedidos` (customer auth Bearer in-memory no processo do server). O card de Meus pedidos mostra `orderNumber` (#1831), não o UUID; fallback no `id` só se não houver número. WhatsApp de suporte do card usa o mesmo número. APIs de tracking/detalhe continuam com `id`.
- Rastreio EnvioEcom na Minha conta: a **Situação** traduz o `envioecomStatus` só na tela (`toCustomerFriendlyShippingLabel`): Pronto para envio / etiqueta / processando / DC-e / envio criado / aguardando postagem → “Estamos embalando seu pedido” + hint “Em breve ele será despachado…”. Aguardando pagamento → “Preparando envio”; saiu para entrega/em rota → “Saiu para entrega”; entregue → “Entregue”. O bloco **Rastreio** usa a mesma timeline em linha do painel admin (`ShippingStatusTimeline`: bolinha, check em Entregue/DC-e, relógio). Eventos do `status_history` ficam com o texto técnico (`location` e descrição), **mais recente no topo**. `POST /api/me/orders/tracking-sync` ao abrir a lista e a cada ~2 min nos abertos; botão Atualizar rastreio chama `GET /api/me/orders/:id/tracking`. Admin e colunas `envioecom_*` continuam com o status técnico.
- Senha de site / payment gate no FE (`SitePasswordGate`) — não confundir com auth admin.

## Decisões pendentes

- Nenhuma autorizada nesta baseline. Novas regras de negócio fora do código devem ser confirmadas com humano antes de entrar aqui.
