# Auth e permissões — KA Imports

> **Última atualização:** 2026-09-02  
> Descreve o que *já existe no código*; não especular.

## Changelog

| Data | O quê | Impacto | O que NÃO mudou |
|------|--------|---------|-----------------|
| 2026-09-02 | Aba Seguro no admin da filial (`isPrimary \|\| tenant ≠ loja1`) | Cada loja grava os próprios `checkout_insurance_*` | Seller-scoped da loja 1 sem a aba; Checkout/Cupons continuam primary |
| 2026-09-02 | Aba Seguro primary-only; carteira `GET /api/me/wallet`; ajuste admin `hasGlobalAccess` | Textos/% do seguro; saldo do cliente | Seller-scoped sem a aba; afiliado inalterado |
| 2026-08-29 | CRUD contas EnvioEcom com `hasGlobalAccess` (filial no próprio tenant); GET mascara segredo | Vendedor seller-scoped continua sem cotar/criar | Papéis inalterados |
| 2026-08-28 | Chaves APPCNPay no mesmo `canManageSettings` (primary ou filial ≠ loja1) | Filial grava o próprio par; GET mascara | Seller-scoped da loja 1 continua sem Configurações |
| 2026-08-27 | Aba Rifas no admin da filial (`isPrimary \|\| tenant ≠ loja1`) | Filial gerencia rifas do próprio tenant | Cupons/checkout/bumps/usuários continuam primary |
| 2026-08-21 | `GET /api/admin/orders/:id` com o mesmo escopo da lista | Comprovante/etiqueta sob demanda | Primary-only inalterado |
| 2026-08-18 | `POST /api/admin/bank-statement/clear` com o mesmo escopo do apply | Desfazer depósito; seller-scoped só o próprio | Primary-only inalterado |
| 2026-08-18 | `GET /api/admin/bank-deposits` com o mesmo escopo do Extrato | Aba Depósitos; seller-scoped só os próprios | Primary-only inalterado |
| 2026-08-18 | Extrato OFX: `requireAdminAuth` + tenant; seller-scoped só os próprios pedidos | Não marca pago | Primary-only inalterado |
| 2026-08-15 | Filial com `hasGlobalAccess` pode editar os próprios pedidos (`PATCH /admin/orders/:id/edit`) | Cada loja edita só o seu tenant | Seller-scoped da loja 1 continua sem editar |
| 2026-08-15 | Impersonar cliente grava `tenantId` na sessão e passa o token no hash da nova aba | “Entrar na conta” abre Meus pedidos em vez de /login | Só `hasGlobalAccess`; sessões continuam in-memory |
| 2026-08-13 | EnvioEcom admin exige `hasGlobalAccess` (loja 1 primary e admin de filial); seller-scoped não opera | Isolamento por loja | Papéis inalterados |
| 2026-08-11 | Extração do modelo de auth do código | Evitar confusão de papéis | Sem mudança de auth |

## Precedência

Código > memória > tipagens.

---

## Papéis (não misturar)

| Papel | O que é | Onde |
|-------|---------|------|
| **Cliente final** | Comprador da loja | `customer_users` + sessão Bearer |
| **Admin primary** | Super-admin (`isPrimary`) | `admin_users` + sessão/cookie |
| **Admin seller-scoped** | Admin limitado a um `sellerCode` | `ADMIN_SELLER_SCOPE_MAP` + sessão |
| **Admin de tenant** | Vínculo `admin_user_tenants` | role default `owner` |
| **Seller** | Link/comissão de vendedor | `sellers.slug` — não é login por si |
| **Afiliado** | Programa de indicação/crédito | `affiliates` ligado a customer |

## Admin

- Arquivo central: `artifacts/api-server/src/routes/admin-auth.ts`.
- Sessão: tabela `admin_sessions`; cookie `admin_session` (nome configurável).
- TTL sessão ~12h.
- Credenciais env bootstrap: `ADMIN_USERNAME` / `ADMIN_PASSWORD` (primary) e `*_2` (secundário).
- `AdminScope`: `{ username, isPrimary, hasGlobalAccess, sellerCode, tenantId }`.
- Primary → `hasGlobalAccess: true`, `sellerCode: null`.
- Seller map: env JSON `ADMIN_SELLER_SCOPE_MAP` `{"usuario":"seller-slug"}`.
- Middleware: `requireAdminAuth`; subset: `requirePrimaryAdmin`.
- EnvioEcom (cotar/criar/etiqueta/config/accounts/shipment-item-name): `hasGlobalAccess` (primary e admin de filial). Seller-scoped recebe 403. GET accounts mascara token/e-mail. POST/PUT/DELETE extras no próprio tenant; não apaga/edita `id=env`. Board `tracking-board` lista/sync com filtro de `sellerCode` se não for global.
- Extrato OFX (`POST /api/admin/bank-statement/analyze|apply|clear`) e histórico (`GET /api/admin/bank-deposits`): `requireAdminAuth`; filtra `tenantId`; seller-scoped só pedidos do próprio `sellerCode`. Não exige primary. `clear` não altera `paid`.
- Editar pedido (`PATCH /api/admin/orders/:id/edit`): `hasGlobalAccess` (primary da loja 1 e admin de filial). Cada um só no próprio `tenantId`. Seller-scoped 403. O botão no FE usa `isPrimary || adminTenantId !== tenant_loja1`.
- Rifas no admin: aba visível com `isPrimary || tenant ≠ tenant_loja1` (igual Produtos). API `/api/admin/raffles*` é `requireAdminAuth` + `tenantId`; seller-scoped da loja 1 não vê a aba.
- Configurações (`GET`/`PUT`/`DELETE /api/admin/settings*`): `canManageSettings` = `isPrimary` **ou** `tenantId ≠ tenant_loja1`. Chaves APPCNPay (`gateway_appcnpay_public_key` / `_secret_key`) estão na allowlist admin, **fora** de `PUBLIC_KEYS`; GET devolve mascarado; PUT com `***` não grava. Escopo é o `tenantId` da sessão (filial não lê/grava as chaves da loja 1). Chaves `checkout_insurance_*` estão em `PUBLIC_KEYS` (checkout lê o GET público). Aba **Seguro** no FE: `isPrimary || tenant ≠ tenant_loja1` (igual Rifas). Seller-scoped da loja 1 não vê.
- Carteira: `GET /api/me/wallet` exige customer auth. `GET /api/admin/wallet/:userId` é `requireAdminAuth`. `POST /api/admin/wallet/adjust` exige `hasGlobalAccess`.
- Procurando produto (`PATCH /api/admin/orders/:id/procurando-produto`): `requireAdminAuth` + escopo do pedido (igual prioridade). Seller-scoped só o próprio `sellerCode`. Não exige primary.
- Detalhe do pedido (`GET /api/admin/orders/:id`): mesmo escopo da lista. Usado para comprovante/etiqueta em `data:` que a lista não envia.
- Rate limit de login admin (janela/tentativas/block via env).
- Smoke: scoped admin toma 403 em endpoints primary-only (`scripts/SMOKE_TESTS.md`).

## Customer

- `artifacts/api-server/src/middlewares/customer-auth.ts` + `routes/customer-auth.ts`.
- Password: PBKDF2 (120k, sha256) + salt.
- Sessões **in-memory** no processo Node (não persistidas em DB) — reinício do server invalida tokens.
- Tenant da sessão = tenant resolvido no registro/login **ou** o `tenantId` do `customer_users` na impersonação admin.
- Impersonar (`POST /api/admin/customers/:id/impersonate`): só `hasGlobalAccess`. A nova aba abre `/minha-conta/pedidos#customerToken=…` (hash, não query); o FE grava em `sessionStorage` e tira o hash. `/auth/me` usa o tenant da sessão com o mesmo legado null/vazio da loja 1.

## Site / payment password gate

- FE: `SitePasswordGate` / `PaymentPasswordGate` — barreira de acesso ao site/link, **não** é auth admin/customer.

## Checkout security

- Token efêmero: FE `getCheckoutToken` → `GET /api/security/checkout-token`.
- Flags env: `SECURITY_ORIGIN_ENFORCE`, `SECURITY_REQUIRE_CHECKOUT_TOKEN_SECRET`.

## Isolamento multi-tenant

- Público: host → `tenants.domain` → `tenantId` (fallback `tenant_loja1`).
- Admin: escopo por tenant + seller; primary gerencia tenants (`routes/tenants.ts`).
- Queries: muitos `or(eq(tenantId), isNull, eq(""))` para loja1 legado.

## Invariantes práticas para agentes

- Nunca expor dados de outro tenant/seller em listagens admin.
- Endpoints “globais” (produtos master, settings sensíveis, tenants, inventory overview, etc.) → verificar se exigem primary.
- Não “promover” seller-scoped a primary no código sem pedido explícito.
