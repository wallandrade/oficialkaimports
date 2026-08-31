# Integrações externas — KA Imports

> **Última atualização:** 2026-08-31  
> Descreve o que *já existe no código*; não especular.

## Changelog

| Data | O quê | Impacto | O que NÃO mudou |
|------|--------|---------|-----------------|
| 2026-08-31 | `hasEnvioEcomLabelReady` aceita status **Etiqueta gerada** (API EnvioEcom) | Create/sync/webhook promovem o card sem PDF no R2 | `enviado` só na coleta; Etiqueta EE/PDF inalterados |
| 2026-08-30 | Create EnvioEcom: `cost` da DACE = valor global da etiqueta, não o R$ 5 da cotação | Etiqueta nova mostra 89,90 etc. | Cotação continua R$ 5; envios já criados |
| 2026-08-30 | Create EnvioEcom colapsa `items` em 1 linha (nome/qty/valor globais) | GET/PUT `shipment-item-name` devolve também `quantity` e `unitCost` | Cotação, webhook, contas e envios já criados |
| 2026-08-30 | Conta EnvioEcom `env` (Railway) se chama **São Paulo** na UI | Cotação/etiqueta e Configurações | `accountId` continua `env`; Minas e extras iguais |
| 2026-08-30 | Espelho estoque Yury Motoboy/Minas (`yury_inventory_balances` + GET snapshot + webhook) | Pools separados só leitura | `inventory_balances` da loja, cobertura Motoboy, baixa de pedido KA |
| 2026-08-29 | Catálogo EnvioEcom multi-conta (`envioecom-accounts.ts`) + CRUD `/admin/envioecom/accounts` | Token por conta; cache de login por `tenantId:accountId` | Webhook público por código; create/quote iguais no restante |
| 2026-08-28 | APPCNPay por tenant: `gateway_appcnpay_*` em `tenant_settings`; fallback `GATEWAY_IDENTIFIER`/`GATEWAY_SECRET` | Filial PIX na própria conta; webhook resolve tenant pelo `transactionId` | DentPeg continua env global; confirmação via webhook |
| 2026-08-26 | Espelho Motoboy da Yury: pull + webhook HMAC de bairros/faixas CEP | Checkout lê cobertura local sincronizada | Agenda, estoque, last-mile e portal de preço inalterados |
| 2026-08-24 | Parser EE lê cidade em `location.name` / `city_name` / município | Timeline grava “Cidade - unidade” | Webhook/Sync iguais |
| 2026-08-24 | Board EE devolve `events`/`lastEvents` (mais recente primeiro); UI expande a timeline | Clique não chama a transportadora | Webhook/Sync e Meus pedidos iguais |
| 2026-08-18 | Tabela `order_bank_deposits`: vários PIX por pedido | Soma no apply/clear/analyze | Parser OFX inalterado; `paid` inalterado |
| 2026-08-18 | Apply OFX `ok` aceita `amountMismatchNote` se PIX ≠ total | Grava valor do PIX + observação no pedido | `confirmed_100`/lote ainda valor igual; parser inalterado |
| 2026-08-18 | Analyze OFX devolve `credits` + `linkableOrders` para busca manual | Vincular PIX por nome ao nº do pedido | Parser/apply/clear iguais |
| 2026-08-18 | Conciliação OFX: match CPF/CNPJ no crédito → score 100% | Confirma pagador pelo documento | Parser OFX / apply iguais |
| 2026-08-18 | `POST /api/admin/bank-statement/clear` + botão Desfazer | Desfaz vínculo depósito errado | Webhooks PIX iguais |
| 2026-08-18 | OFX v2: skip FITID já salvo; só Inter manual; `GET /admin/bank-deposits` | Histórico persistente; gateway PIX fora da conciliação | Webhook PIX e EnvioEcom inalterados |
| 2026-08-18 | Extrato OFX Inter: `POST /admin/bank-statement/analyze\|apply` | Concilia PIX recebido com pedido; não baixa PDF | Gateway PIX e EnvioEcom inalterados |
| 2026-08-17 | Vincular EE: cola ID/rastreio no pedido via `POST .../sync` | Envio criado no painel EE liga no card | Cotação/create inalterados |
| 2026-08-16 | Create EnvioEcom recusa CPF/telefone/e-mail inválidos; loga 400 da API e o toast junta `details` | Admin vê o motivo; log Railway deixa de ser só `400` | Cotação, etiqueta e token inalterados |
| 2026-08-15 | Gerar etiqueta EnvioEcom grava “Etiqueta emitida”; admin aborta GET velho e preserva PDF na lista | Evita badge Pendente por corrida de refresh | Token continua só no backend |
| 2026-08-15 | Timeline EnvioEcom grava `location` do `status_history` e aparece no card de Meus pedidos | Cliente vê cidade/unidade sem modal; sync ao abrir a lista | Cotar/criar/etiqueta e board admin |
| 2026-08-14 | Cancelamento EnvioEcom tira “Pronto para envio”, devolve à fila 48h e webhook aceita payload aninhado | Card e logística acompanham o status da API | PIX/Concluído do pedido e `enviado` já baixado |
| 2026-08-14 | Aba Rastreios EE: KPIs, grupos, busca, sync lote dos abertos, PDF e link do pedido | Board lê o BD; Sync consulta EnvioEcom | Cotar/criar/etiqueta continuam `hasGlobalAccess` |
| 2026-08-13 | Cotação EnvioEcom: pacote padrão 2×12×17, 0,3 kg, R$ 5, 1 linha | Preço bate o simulador do painel | Checkout continua `shipping_options` |
| 2026-08-13 | `enviado` EnvioEcom só após coleta/postagem (não na etiqueta/DC-e) | Webhook/sync vira Enviado; gerar PDF fica Pronto para envio | Token continua só no backend |
| 2026-08-13 | Etiqueta EnvioEcom pronta libera fila 48/72/96h sem forçar `enviado` se faltar estoque | Pedido embalado não ocupa prazo de postagem | Token continua só no backend |
| 2026-08-13 | EnvioEcom (whitelabel): cotação, create, etiqueta PDF, webhook, rastreio admin/cliente por tenant | Logística automatizada por loja/filial; token só no backend | Frete do checkout continua `shipping_options`; PIX/OCR de etiqueta manual permanecem |
| 2026-08-11 | Inventário de providers no código | Leitura seletiva por integração | Sem troca de provider |

## Precedência

Código > memória. Não reintroduzir providers antigos sem evidência.

---

## PIX / gateways

| Provider | Uso | Código |
|----------|-----|--------|
| **APPCNPay** | Default PIX | `artifacts/api-server/src/gateway.ts` + `lib/pix-gateway-credentials.ts` |
| **DentPeg** | Alternativa; fallback para APPCNPay se limite/`too_big` | `DENTPEG_API_KEY`, `DENTPEG_BASE_URL` (env global, não por loja) |

- Seleção: setting `checkout_pix_gateway` / normalizer `normalizePixGatewayProvider`.
- **Credenciais APPCNPay por loja:** `tenant_settings` `gateway_appcnpay_public_key` + `gateway_appcnpay_secret_key` (as duas juntas). Sem o par, usa env `GATEWAY_IDENTIFIER` / `GATEWAY_SECRET`. Não mistura pública da loja com secret do env. GET admin mascara; PUT com valor `***` é no-op. Admin Configurações: bloco “Credenciais APPCNPay desta loja”; “Usar chaves globais” = DELETE. Chaves **não** vão para `localStorage` nem `PUBLIC_KEYS`.
- Checkout, `/pix/generate`, cobrança custom, PIX de diferença, rifas passam `tenantId` em `createPixCharge*`. Webhook não confiável: `findTenantIdByPixTransactionId` (pedido / cobrança / reserva) e `fetchTransactionStatus(txId, tenantId)`.
- Webhook confirmação: `/api/webhook/pix` (+ webhook universal `/api/webhook`). No painel APPCNPay da conta da loja: `{origin}/api/webhook/pix`.
- **Não** depender de GET transactions para confirmação (polling bloqueado no APPCNPay).
- Status local: endpoints de status leem BD.

## Storage

- **Cloudflare R2** (S3-compatible): upload imagens produto/comprovantes etc. (`lib/r2.ts`).
- Etiqueta EnvioEcom: PDF em `tracking-labels/` via `uploadShipmentLabelPdfToR2`.
- Script migrate: `scripts/src/migrate-product-images-to-r2.ts`.

## EnvioEcom (frete / etiqueta / rastreio)

- Base: `https://envioecom.com.br/api/v1/whitelabel` (override `ENVIOECOM_BASE_URL`).
- Auth: header `X-Partner-Token`. Client em `artifacts/api-server/src/lib/envioecom-client.ts`.
- **Frontend nunca chama a EnvioEcom.** Só o backend.
- Config **por tenant**: medidas default, carriers e item da etiqueta (`envioecom_shipment_item_name`, `_quantity`, `_unit_cost`) continuam da loja. Credencial + CEP origem são **por conta** (`env` do Railway só loja 1; `tenant` nas keys `envioecom_token` etc.; extras JSON `envioecom_accounts`). Env **não** entra no JSON. GET `/admin/envioecom/accounts` mascara token/e-mail; POST/PUT/DELETE extras com `hasGlobalAccess` (filial no próprio tenant). Campo em branco no PUT = manter.
- Rotas admin (`hasGlobalAccess`, não seller-scoped): quote/create/labels/sync/cancel/bind-id, tracking-board, config, CRUD accounts, GET/PUT `shipment-item-name`, registrar webhook em **todas** as contas. Quote/create aceitam `accountId` no body e devolvem `accountId`. Sync/labels/cancel fazem fallback entre contas.
- **Vincular EE**: modal no card (não `window.prompt`). Admin cola ID (4–10 dígitos → `shipment_id`) ou rastreio (`barcode`). `POST /api/admin/envioecom/orders/:id/sync` com esse body busca na EE (`getById` / `getByIdentifier`; se o admin colou e falhou, tenta `list` por CPF/CEP/nome) e grava com `persistEnvioEcomShipment`. Não cria envio novo. Etiqueta com barcode `EC…` reabre o mesmo modal.
- Board `GET /api/admin/envioecom/tracking-board` devolve `{ summary, items, configured }` (grupos delivered/in_transit/awaiting/cancelled/other). Cada item inclui `events` (histórico mais recente primeiro, até 80) e `lastEvents` (5). `POST .../tracking-board/sync` atualiza até 20–30 abertos. Aba **Rastreios** não chama a transportadora até Sync; o clique só abre a timeline local. Campos “Item da etiqueta no create” (nome, quantidade, valor global) gravam os settings da loja.
- Público: `POST /api/webhook/envioecom` (2xx rápido; match barcode → `external_order_number` → `shipment_id`; aceita body plano ou `data`/`shipment`; eventos com barcode/status não são ignorados). Idempotente barcode+status. Histórico vem de `status_history` (status + `location` cidade/unidade, também `location.name`, `city_name`, `municipio`); 2+ eventos substituem o JSON local, 1 evento faz append idempotente. Não grava nota “Status atualizado ao consultar rastreio”.
- Create (`POST /shipping/create`): sempre **1 item**. `name` / `quantity` / `unit_cost` vêm dos settings da loja (defaults Mercadoria, 1, R$ 5). O campo `cost` da DACE (valor declarado) é qty × unit_cost, **não** o R$ 5 da cotação. Nunca nome, quantidade nem preço do pedido/catálogo. Envios já criados não mudam; para alterar é cancelar + criar de novo. Antes do create a API recusa CPF/CNPJ que não tenha 11/14 dígitos (ou só zeros), telefone com menos de 10 dígitos e e-mail sem `@`. Não envia mais CPF placeholder `000.000.000-00`. Erro da EnvioEcom é logado (`[EnvioEcom] code/message/details`) e o toast junta `message` + `details`.
- `enviado=true` via `ensureOrderMarkedEnviado` só em status de coleta/postagem/trânsito, não no PDF/DC-e. Etiqueta pronta ainda chama `completeOrderLogistics` (vaga `shipped`). `hasEnvioEcomLabelReady` aceita **Etiqueta emitida**, **Etiqueta gerada** (texto da EnvioEcom no create/sync/webhook) e DC-e, além de PDF em `envioecomLabelUrl`. Ao gerar PDF, status “Envio criado” vira **Etiqueta emitida**. Status **Cancelado** (webhook/sync/cancel): `hasEnvioEcomLabelReady` fica false mesmo com PDF; se `enviado` ainda é false, `allocateOrderLogistics` devolve o pedido à fila 48/72/96h.
- Cliente: `GET /api/me/orders/:id/tracking` (soft-sync de um pedido). `POST /api/me/orders/tracking-sync` atualiza até 8–10 pedidos abertos **ou com histórico sem cidade**. Meus pedidos mostra a mesma timeline em linha do board admin (`ShippingStatusTimeline`) e faz poll ~2 min nos abertos/sem cidade.
- Regras: 1 pacote consolidado; sem medidas no produto usa caixa padrão 2×12×17 cm, 0,3 kg, valor declarado R$ 5 (`aviso_recebimento: false`); com medidas reais no item usa essas + valor do produto. `cep_origem` obrigatório; `shipping_company` idêntico à cotação; etiqueta por `ids` (nunca barcode `EC…`); após create `GET /shipments/by-id/{id}`; status é texto livre.

## E-mail / CRM

- **Brevo**: sync de contatos + checagem de conta (`lib/brevo.ts`, `routes/brevo.ts`).
- API key via setting `brevo_api_key`.

## Catálogo auxiliar

- **Google Sheets** fallback de produtos se DB vazio (`routes/products.ts`; env `GOOGLE_SHEET_ID` citada em docs).
- **Extrato OFX (Banco Inter):** parser `lib/ofx-bank-statement.ts` + match `lib/bank-statement-reconcile.ts` (`matchIdentityScore`: CPF/CNPJ em NAME/MEMO = 1.0) + filtro `lib/bank-deposit-manual.ts`; rotas `POST /api/admin/bank-statement/analyze`, `/apply`, `/clear`, `GET /api/admin/bank-deposits`. Analyze também devolve `credits` (todos os PIX, `alreadyUsed`) e `linkableOrders` (pedidos manuais + `bankDepositFitids`/`bankDepositAmount`) para busca/vínculo manual. Arquivo lido no browser; só créditos novos entram no match automático (FITID ainda não gravado); conta mascarada. Não baixa comprovante do Inter. PIX com `transactionId` (CNPay/DentPeg) não entra no match. `clear` aceita `fitid` opcional. Apply `ok` com soma ≠ total exige `amountMismatchNote`; `confirmed_100` recusa valor diferente. Vários PIX por pedido em `order_bank_deposits` (FITID único).

## Motoboy cobertura (Yury → KA)

- Este repo é **espelho**. Fonte: Yury (`YURY_API_BASE`, default `https://api.yury-imports.com`).
- Pull: `GET /api/integrations/motoboy/coverage` com `Authorization: Bearer` / `X-Api-Key` (`YURY_MOTOBOY_SYNC_TOKEN`). Job a cada 15 min + botão Admin Fretes. Replica em tenants ativos. `yury_id` unique por loja; `id` local permanece para reservas.
- Webhook: `POST /api/webhooks/yury/motoboy-coverage` e `POST /webhooks/yury/motoboy-coverage`. Body **cru** + `X-Yury-Signature: sha256=<hmac>` + timestamp ≤ 5 min (`YURY_MOTOBOY_WEBHOOK_SECRET`). Idempotência em `yury_webhook_events_processed`.
- Eventos: `motoboy.neighborhood|cep_range.upserted|deactivated|deleted` e `motoboy.coverage.full_sync_requested`.
- Com token configurado, CRUD local de bairro/faixa retorna 409 `YURY_COVERAGE_LOCKED`. Seed Motoboy é pulado no boot.
- **Não inclui:** propostas de bairro (fase 2), portal de preço, agenda, last-mile.

## Estoque Motoboy / Minas (Yury → KA)

- Espelho **só leitura**. Fonte: Yury (`GET /api/integrations/inventory/snapshot`). KA **não escreve** na Yury e **não** usa `/api/admin/inventory/...` deles.
- Token: `YURY_INVENTORY_SYNC_TOKEN` se existir; senão o mesmo `YURY_MOTOBOY_SYNC_TOKEN` da cobertura. Headers `Authorization: Bearer` + `X-Api-Key`.
- Persistência: tabela `yury_inventory_balances` (`product_id` da Yury, `qty_motoboy`, `qty_minas`). **Não** mistura com `inventory_balances` (estoque da loja). Não soma os dois pools. Não dá baixa de pedido KA nesses saldos.
- Snapshot: linha com `quantity: 0` permanece. Produto só em `motoboy[]` → Minas = 0 (Motoboy do array). Zerar os dois só se o `productId` sumir dos dois arrays.
- Job: boot (~20s) + a cada 3 min. Admin Estoque puxa ao abrir e no botão Sincronizar Yury (`POST /api/admin/yury-inventory/sync`). Lista: `GET /api/admin/yury-inventory`.
- Webhook: `POST /api/webhooks/yury/inventory` (+ `/webhooks/yury/inventory`). Body cru + HMAC igual à cobertura (`YURY_MOTOBOY_WEBHOOK_SECRET`, `X-Yury-Signature: sha256=<hex>`, timestamp ≤ 5 min). Idempotência em `yury_webhook_events_processed`. Evento `inventory.changed`: **não** aplica `quantityDelta`; grava `data.balances.motoboy` e `data.balances.minas`.
- Erros do GET remoto: 401 token · 503 sync desligado · 500 retry no próximo ciclo.

## Geo / IP

- Lookup IP no checkout/pedidos (`lib/ip-geo.ts`) — campos `purchaseIp`, `ipCity`, etc. no pedido.

## Notificações realtime

- SSE / broadcast admin (`routes/notifications.ts`) + Service Worker local no browser.

## Outbound webhook

- Teste admin primary: `/api/admin/outbound-webhook/test` (`lib/outbound-webhook.ts`).

## Front hosting ↔ API

- Vercel rewrite `/api/*` → Railway production URL (ver `vercel.json` raiz e/ou `artifacts/ka-imports/vercel.json`).

## Regra de leitura

- Só abrir dumps/docs de um provider quando a tarefa for daquela integração.
- Não inventar SDK fiscal, Stripe, Mercado Pago, etc. sem aparecer no código.
