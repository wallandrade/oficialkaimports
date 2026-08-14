# Integrações externas — KA Imports

> **Última atualização:** 2026-08-14  
> Descreve o que *já existe no código*; não especular.

## Changelog

| Data | O quê | Impacto | O que NÃO mudou |
|------|--------|---------|-----------------|
| 2026-08-14 | Create EnvioEcom usa `items[].name` genérico (`tenant_settings.envioecom_shipment_item_name`, default Mercadoria) | Nome do catálogo nunca vai no POST /shipping/create | Cotação, webhook e sync de status |
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
| **APPCNPay** | Default PIX | `artifacts/api-server/src/gateway.ts` — `GATEWAY_PIX_URL`, headers `GATEWAY_IDENTIFIER` / `GATEWAY_SECRET` |
| **DentPeg** | Alternativa; fallback para APPCNPay se limite/`too_big` | `DENTPEG_API_KEY`, `DENTPEG_BASE_URL` |

- Seleção: setting `checkout_pix_gateway` / normalizer `normalizePixGatewayProvider`.
- Webhook confirmação: `/api/webhook/pix` (+ webhook universal `/api/webhook`).
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
- Config **por tenant** (`tenant_settings`: token/email/senha, CEP origem, medidas default, carriers, `envioecom_shipment_item_name`). Fallback de env (`ENVIOECOM_TOKEN` etc.) só para loja 1.
- Rotas admin (`hasGlobalAccess`, não seller-scoped): quote/create/labels/sync/cancel/bind-id, tracking-board, config, GET/PUT `shipment-item-name`, registrar webhook.
- Board `GET /api/admin/envioecom/tracking-board` devolve `{ summary, items, configured }` (grupos delivered/in_transit/awaiting/cancelled/other). `POST .../tracking-board/sync` atualiza até 20–30 abertos. Aba **Rastreios EE** não chama a transportadora até Sync. Campo “Nome do produto no create” grava o setting da loja.
- Público: `POST /api/webhook/envioecom` (2xx rápido; match barcode → `external_order_number` → `shipment_id`; idempotente barcode+status).
- Cliente: `GET /api/me/orders/:id/tracking` (soft-sync).
- Regras: 1 pacote consolidado; sem medidas no produto usa caixa padrão 2×12×17 cm, 0,3 kg, valor declarado R$ 5 (`aviso_recebimento: false`); com medidas reais no item usa essas + valor do produto. `cep_origem` obrigatório; `shipping_company` idêntico à cotação; etiqueta por `ids` (nunca barcode `EC…`); após create `GET /shipments/by-id/{id}`; status é texto livre.
- Create (`POST /shipping/create`): `items[].name` é o texto genérico da loja (até 120 chars, default **Mercadoria**). Nunca o nome do produto do catálogo. Quantidade e `unit_cost` vêm do item; pedido sem produtos → 1 item genérico, qty 1, `unit_cost` = subtotal. Envios já criados não mudam; para alterar o nome é cancelar + criar de novo.
- `enviado=true` via `ensureOrderMarkedEnviado` só em status de coleta/postagem/trânsito, não no PDF/DC-e. Etiqueta pronta ainda chama `completeOrderLogistics` (vaga `shipped`).

## E-mail / CRM

- **Brevo**: sync de contatos + checagem de conta (`lib/brevo.ts`, `routes/brevo.ts`).
- API key via setting `brevo_api_key`.

## Catálogo auxiliar

- **Google Sheets** fallback de produtos se DB vazio (`routes/products.ts`; env `GOOGLE_SHEET_ID` citada em docs).

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
