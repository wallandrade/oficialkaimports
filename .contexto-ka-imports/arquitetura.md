# Arquitetura — KA Imports

> **Última atualização:** 2026-08-30  
> Descreve o que *já existe no código*; não especular.

## Changelog

| Data | O quê | Impacto | O que NÃO mudou |
|------|--------|---------|-----------------|
| 2026-08-30 | Tabela `yury_inventory_balances` + job 3 min + webhook `/api/webhooks/yury/inventory` | Espelho Motoboy/Minas da Yury | `inventory_balances` e cobertura Motoboy inalterados |
| 2026-08-29 | `orders.envioecom_account_id` + catálogo de contas EnvioEcom em `tenant_settings` | Roteamento de credencial; ALTER runtime | Stack FE/API e demais colunas EE iguais |
| 2026-08-28 | PIX APPCNPay: `createPixCharge*` / `fetchTransactionStatus` recebem `tenantId`; chaves em `tenant_settings` | Conta gateway por loja | Stack FE/API/DB e DentPeg inalterados |
| 2026-08-26 | Espelho Motoboy Yury: `yury_id` + tabela `yury_webhook_events_processed` | Pull/webhook de cobertura | Pedidos/agenda Motoboy inalterados |
| 2026-08-26 | `motoboy_neighborhoods.interval_hours`; settings Motoboy no checkout | Duração do slot e whitelist/frete grátis 2× | Portal/estoque Motoboy e EnvioEcom inalterados |
| 2026-08-21 | Lista de pedidos admin: JSON leve (sem `data:`/OCR); `GET /admin/orders/:id` carrega mídia | Data e lista mais rápidas; comprovante no clique | Filtros e PIX inalterados |
| 2026-08-18 | Tabela `order_bank_deposits` + resumo em `orders.bank_deposit_*` | Vários PIX por pedido | Stack FE/API inalterada |
| 2026-08-18 | `POST /admin/bank-statement/clear` zera vínculo no pedido | Desfazer na aba Depósitos | Stack FE/API/DB inalterada |
| 2026-08-18 | `GET /admin/bank-deposits` + filtro Inter manual no analyze | Aba Depósitos; Extrato não persiste sessão | Stack FE/API/DB inalterada |
| 2026-08-18 | Colunas `bank_deposit_*` em `orders` + rotas Extrato | Conciliação OFX no api-server | Stack FE/API/DB inalterada |
| 2026-08-15 | `fetchOrders` aborta GET anterior e faz merge que preserva PDF EnvioEcom | Evita corrida com auto-refresh 20s | Stack FE/API/DB inalterada |
| 2026-08-15 | `POST /api/me/orders/tracking-sync` + parser de `status_history` com `location` | Cliente sincroniza rastreio em lote | Colunas `envioecom_*` inalteradas |
| 2026-08-13 | Rotas EnvioEcom + colunas `envioecom_*` em `orders` + R2 PDF | Logística externa no api-server | Stack FE/API/DB inalterada |
| 2026-08-11 | Criação inicial | Mapa de stack/pastas para agentes | Deploy/runtime inalterados |

## Precedência

Código > esta memória > suposições. Se `replit.md` ou docs `*_ANALYSIS.md` divergirem do código, **seguir o código**.

---

## Visão geral

Monorepo **pnpm workspaces** + TypeScript.

| Pacote | Path | Papel |
|--------|------|--------|
| FE loja/admin | `artifacts/ka-imports` | React 19 + Vite + Wouter + Zustand + TanStack Query + Tailwind/Radix |
| API | `artifacts/api-server` | Express 5, bundle esbuild |
| Sandbox UI | `artifacts/mockup-sandbox` | Não é o app de produção |
| DB | `lib/db` | Drizzle + **MySQL** (`mysql2`) |
| OpenAPI | `lib/api-spec` | `openapi.yaml` + Orval |
| Client FE gerado | `lib/api-client-react` | React Query hooks |
| Zod gerado | `lib/api-zod` | Validators |
| Scripts | `scripts` | Admin, smoke tenant, backfills, R2 migrate |

**Não é** Next.js / Nest / Prisma / Postgres (apesar de docs antigos citarem Postgres).

## Banco

- Dialect: **MySQL** — `drizzle.config.ts`, `lib/db/src/index.ts`.
- Schema: `lib/db/src/schema/*.ts` (export em `schema/index.ts`).
- Push: `drizzle-kit push` (scripts no `lib/db` e no start do api-server).
- Runtime schema extras: `artifacts/api-server/src/runtime-schema.ts`.

### Tabelas principais (não exaustivo)

- `tenants`, `admin_users`, `admin_user_tenants`, `admin_sessions`
- `orders` (incl. `envioecom_*`, `enviado`, `is_prioridade`, `is_procurando_produto`, `tracking_*`, `bank_deposit_*`), `order_bank_deposits` (vários PIX OFX por pedido), `custom_charges`, `products`, `coupons`, `sellers`
- `customer_users`, `affiliates` (+ referrals/commissions/credit uses)
- `kyc_documents`, `site_settings` / `tenant_settings`
- `shipping_options`, `motoboy_*` (incl. `yury_id` na cobertura), `yury_webhook_events_processed`, `order_logistics_allocations`
- `inventory_balances` / `inventory_movements`, `yury_inventory_balances` (espelho Motoboy/Minas da Yury), `reshipments`, `manual_*`
- `raffles*`, `order_bumps`, `support_tickets`, `filial_purchase_*`
- `marketing_expenses`, `seller_commission_payments`, `social_proof_*`, `product_cost_history`

## API

- Entry: `artifacts/api-server/src/index.ts` → `app.ts` → `routes/index.ts`.
- Health: `GET /healthz`.
- Jobs no boot: reconciliação (expiração 24h), raffle expiry, reconcile logistics, pull de cobertura Motoboy Yury (15 min, se token), pull de estoque Motoboy/Minas Yury (3 min, se token).
- Webhook cobertura Motoboy: `POST /api/webhooks/yury/motoboy-coverage` (body cru + HMAC) **antes** de `express.json()`.
- Webhook estoque Yury: `POST /api/webhooks/yury/inventory` (mesmo HMAC; grava `balances`, não o delta).
- EnvioEcom: `artifacts/api-server/src/routes/envioecom.ts` + webhook em `webhooks.ts`. Contas em `lib/envioecom-accounts.ts` (env + tenant + JSON `envioecom_accounts`). Client cacheia token por `tenantId:accountId`. Coluna `orders.envioecom_account_id`.
- APPCNPay: `gateway.ts` + `lib/pix-gateway-credentials.ts`. Par por tenant (`gateway_appcnpay_public_key` / `_secret_key`); fallback env. Webhook PIX resolve tenant pelo `transactionId`.
- Extrato OFX: `artifacts/api-server/src/routes/bank-statement.ts` (`analyze`/`apply`/`clear`/`bank-deposits`) + `order_bank_deposits`. Painéis FE: `AdminBankStatementPanel.tsx` (sessão) e `AdminBankDepositsPanel.tsx` (histórico + Desfazer por FITID).
- Lista admin: `GET /admin/orders` em modo leve (sem `data:`/OCR); `GET /admin/orders/:id` devolve mídia completa.
- OpenAPI cobre só um subconjunto (health/products/pix/orders…); **muitas rotas existem só no Express** — não assumir que Orval cobre tudo.

## Frontend

- Rotas: `artifacts/ka-imports/src/App.tsx` (wouter).
- Carrinho: Zustand persist `src/store/use-cart.ts`.
- Admin monolítico: `src/pages/Admin.tsx` (arquivo grande — leitura seletiva). `fetchOrders` usa AbortController + seq e não apaga `envioecomLabelUrl` se o GET vier vazio. Busca de pedidos: input com debounce 300ms. Troca de data da lista não chama `fetchStatsData`.
- Proxy/API: requests sob `/api` (Vercel rewrite → Railway).
- SW: `public/sw.js` — **somente notificações admin**, não PWA offline/sync.

## Auth (resumo)

- Admin: sessão DB + cookie; ver `auth-permissoes.md`.
- Customer: Bearer token em Map in-memory no processo (`middlewares/customer-auth.ts`).
- Checkout: token de segurança (`checkout-security.ts` + `/api/security/checkout-token` no app).

## Storage / mídia

- Cloudflare R2 via S3 SDK (`artifacts/api-server/src/lib/r2.ts`).
- Env: `CLOUDFLARE_R2_*`.

## Deploy / ambientes conhecidos

| Camada | Evidência |
|--------|-----------|
| FE prod | `vercel.json` → `https://ka-imports.com` / `www` (CORS default no `app.ts`) |
| API prod | Rewrite Vercel → `https://oficialkaimports-production.up.railway.app/api/...` |
| Railway | `railway.json` start: `pnpm --filter @workspace/api-server start-only` |
| Nixpacks | `nixpacks.toml` (Node 22, pnpm 9, filter api-server) |
| Replit | `.replit` / `replit.md` (legado/dev — docs podem estar desatualizados) |

## Offline

- Sem sync offline / IndexedDB de pedidos. SW = push/local notification only.

## Áreas caras de contexto (leitura seletiva)

- `artifacts/ka-imports/src/pages/Admin.tsx`
- `artifacts/api-server/src/routes/orders.ts`, `checkout.ts`
- `lib/api-client-react/src/generated/**`, `lib/api-zod/src/generated/**`
- Docs longos na raiz (`*_ANALYSIS.md`, `*_CATALOG_*.md`, `PERFORMANCE_*.md`)
- `ka-imports-frontend-backup.zip`, `attached_assets/`, `node_modules/`, `dist/`
- `artifacts/mockup-sandbox/**` (só se a tarefa for sandbox)

## TODO confirmar com humano

- Lista completa de domínios de tenants em produção (além de ka-imports.com).
- Se OpenAPI será expandido para cobrir todas as rotas novas.
