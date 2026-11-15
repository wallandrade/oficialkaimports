# Auth e permissões — KA Imports

> **Última atualização:** 2026-11-14
> Descreve o que *já existe no código*; não especular.

## Changelog

| Data | O quê | Impacto | O que NÃO mudou |
|------|--------|---------|-----------------|
| 2026-11-14 | Convidado recebe saldo e pode ganhar senha | `POST /api/admin/wallet/adjust` com `guest:<email>` cria a conta na loja da sessão e credita. `PATCH .../password` no mesmo id abre a conta e grava a senha. Os dois exigem `hasGlobalAccess`. Seller-scoped 403. Outra loja 404, sem linha e sem saldo. Login da conta sem senha é 401 `PASSWORD_NOT_SET`; **Criar conta** define a senha | Impersonar continua só em conta já existente. Superadmin não lê carteira de outra loja |
| 2026-11-13 | Vitrine sem tenant não usa a loja 1 | Host desconhecido: 404 `store_not_configured`. Fallback `tenant_loja1` só na loja principal, local, preview e app da API | Login admin continua por usuário e sessão. Webhooks não resolvem tenant pelo host |
| 2026-11-13 | Declaração KYC, catálogo do pedido e fila de retorno na loja da sessão | `PATCH /admin/kyc/:orderId` não grava documento de outra loja. Troca e edição de produto leem o catálogo da loja do pedido. Retorno manual grava e filtra `tenant_id` | Seller-scoped continua sem editar pedido. Loja 1 inclui legado nulo/`''` |
| 2026-11-13 | Brevo só para o superadmin | `GET/PUT /api/admin/brevo/config` e `POST /api/admin/brevo/sync-customers` usam `requirePrimaryAdmin`. Admin de filial com `hasGlobalAccess` toma 403 | A chave continua global em `site_settings`. Sync não inclui cliente de filial |
| 2026-11-08 | `GET /api/admin/users` devolve `tenantId` e `tenantName` | Aba Usuários separa loja padrão e filiais. A loja segue o login: vínculo fora de `tenant_loja1`, owner primeiro | Criar, senha, acesso, apagar e o vínculo de vendedor. Novo usuário continua só da loja padrão. Admin de filial continua na aba Lojas |
| 2026-11-08 | Vínculo de vendedor no painel e autor estável no histórico | Superadmin grava qual login vê qual slug, por loja. Sessão relê o vínculo. `order_events` ganha `actor_admin_user_id` nas ações novas de admin | Admin de filial não ganha a aba Usuários. Mapa antigo só vale se ninguém gravou ou removeu o vínculo. Username antigo do evento permanece |
| 2026-11-08 | Slug de vendedor, impersonar, rifa e leitura de carteira | Slug de outra loja responde 409 e não grava. Filial só impersona e lê carteira do próprio tenant. Seller-scoped toma 403 em rifa e carteira | Superadmin ainda impersona outra loja. Filial segue com rifa e carteira da própria loja. Cupom, pedido e comissão de vendedor iguais |
| 2026-10-03 | `POST /api/admin/affiliates/:userId/balance` | Mesmo `hasGlobalAccess` da lista de afiliados. Seller-scoped 403 | Carteira do seguro; comissão de vendedor |
| 2026-09-28 | Painel apaga a Conta da loja EnvioEcom (`DELETE .../accounts/tenant`) | Mesmo `hasGlobalAccess` do CRUD de contas | Conta `env` segue sem editar/apagar; seller-scoped 403 |
| 2026-09-16 | `POST /admin/orders/:id/replace-product` exige `hasGlobalAccess` | Mesmo recorte do Editar pedido | Seller-scoped; reenvio |
| 2026-09-12 | Admin redefine senha do cliente (`PATCH /admin/customers/:id/password`); sessões Bearer daquele user caem | Só `hasGlobalAccess` + tenant; min 8 | Impersonar; convidado; senha de admin |
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
- Seller map: env JSON `ADMIN_SELLER_SCOPE_MAP` `{"usuario":"seller-slug"}` continua só para conta antiga sem linha em `admin_seller_scopes`. O painel, na aba Usuários do superadmin, grava o vínculo (`linked` ou `cleared`). `cleared` não volta para o mapa. A sessão nova guarda `admin_user_id`; a cada pedido o servidor relê o vínculo. Admin de filial não cria esses logins.
- Boot: `ensureRuntimeSchema` cria `admin_seller_scopes` se faltar e acrescenta `order_events.actor_admin_user_id` e `admin_sessions.admin_user_id` se faltarem. Não apaga linha. Rollback do código pode deixar essas colunas. Evento antigo fica legível, com id de autor vazio. Não há autoria retroativa.
- Middleware: `requireAdminAuth`; subset: `requirePrimaryAdmin`.
- Brevo (`/api/admin/brevo/config` e `/sync-customers`): só `requirePrimaryAdmin`. Não basta `hasGlobalAccess`. A chave é global; o sync só exporta cliente e pedido da loja 1 (inclui `tenant_id` vazio legado).
- `GET /api/admin/users` (primary): cada usuário traz `tenantId`, `tenantName` e `sellerAccess`. A loja é a mesma do login (`lib/admin-tenant-pick.ts`): owner fora de `tenant_loja1`, senão qualquer vínculo fora da loja 1, senão loja 1. O backfill que liga todo admin à loja 1 não coloca a filial na lista da loja padrão. A aba Usuários mostra dois blocos: **Loja padrão** e **Lojas filiais** (agrupadas pelo nome). O vínculo de vendedor continua na linha. `POST /api/admin/users` continua criando usuário sem vínculo de filial.
- EnvioEcom (cotar/criar/etiqueta/config/accounts/shipment-item-name): `hasGlobalAccess` (primary e admin de filial). Seller-scoped recebe 403. GET accounts mascara token/e-mail. POST/PUT/DELETE da Conta da loja e das extras no próprio tenant; não apaga/edita `id=env`. Apagar a Conta da loja tira token, e-mail e senha; o CEP de origem permanece. Board `tracking-board` lista/sync com filtro de `sellerCode` se não for global.
- Extrato OFX (`POST /api/admin/bank-statement/analyze|apply|clear`) e histórico (`GET /api/admin/bank-deposits`): `requireAdminAuth`; filtra `tenantId`; seller-scoped só pedidos do próprio `sellerCode`. Não exige primary. `clear` não altera `paid`.
- Editar pedido (`PATCH /api/admin/orders/:id/edit`) e troca de produto (`POST /api/admin/orders/:id/replace-product`): `hasGlobalAccess` (primary da loja 1 e admin de filial). Cada um só no próprio `tenantId`. A ficha do produto usa a loja do pedido, ou a da sessão se o pedido não tiver loja. Loja 1 inclui produto com tenant nulo ou `''`. Seller-scoped 403. O botão no FE usa `isPrimary || adminTenantId !== tenant_loja1`.
- Declaração KYC (`PATCH /api/admin/kyc/:orderId`): mesma sessão. Documento de outra loja responde 404. Loja 1 inclui `kyc_documents.tenant_id` nulo ou `''`.
- Fila de produto voltando (`POST/PATCH /api/admin/manual-return-items` e a lista no overview): `hasGlobalAccess` e a loja da sessão. Item de outra loja não aparece e o status responde 404. Loja 1 inclui linha antiga sem tenant.
- Rifas no admin: aba visível com `isPrimary || tenant ≠ tenant_loja1` (igual Produtos). API `/api/admin/raffles*` exige `requireStoreWideAdmin` (`hasGlobalAccess`) e a loja da sessão. Seller-scoped toma 403 antes de procurar o id. Apagar rifa de outra loja ou id inexistente responde 404. Não há `?tenantId=` nesta rota.
- Configurações (`GET`/`PUT`/`DELETE /api/admin/settings*`): `canManageSettings` = `isPrimary` **ou** `tenantId ≠ tenant_loja1`. Chaves APPCNPay (`gateway_appcnpay_public_key` / `_secret_key`) estão na allowlist admin, **fora** de `PUBLIC_KEYS`; GET devolve mascarado; PUT com `***` não grava. Escopo é o `tenantId` da sessão (filial não lê/grava as chaves da loja 1). Chaves `checkout_insurance_*` estão em `PUBLIC_KEYS` (checkout lê o GET público). Aba **Seguro** no FE: `isPrimary || tenant ≠ tenant_loja1` (igual Rifas). Seller-scoped da loja 1 não vê.
- Carteira: `GET /api/me/wallet` exige customer auth. `GET /api/admin/wallet/:userId` e o ajuste exigem `hasGlobalAccess` e o cliente da loja da sessão. `guest:<email>` no GET não cria conta: 0 se houver pedido na loja, 404 se não. O POST cria a conta, gruda os pedidos e credita. `idempotencyKey` igual não lança a mesma linha de novo. Seller-scoped toma 403. Id de outra loja ou inexistente responde 404, sem saldo. Não há parâmetro para o superadmin ler a carteira de outra loja. O e-mail único passou a ser por loja (`tenant_id` + `email`).
- Procurando produto (`PATCH /api/admin/orders/:id/procurando-produto`): `requireAdminAuth` + escopo do pedido (igual prioridade). Seller-scoped só o próprio `sellerCode`. Não exige primary.
- Detalhe do pedido (`GET /api/admin/orders/:id`): mesmo escopo da lista. Usado para comprovante/etiqueta em `data:` que a lista não envia.
- Rate limit de login admin (janela/tentativas/block via env).
- Smoke: scoped admin toma 403 em endpoints primary-only (`scripts/SMOKE_TESTS.md`).

## Customer

- `artifacts/api-server/src/middlewares/customer-auth.ts` + `routes/customer-auth.ts`.
- Password: PBKDF2 (120k, sha256) + salt.
- CPF opcional (`document`, 11 dígitos) no register/login; grava na conta se ainda vazio.
- `attachGuestOrdersForCustomer` no register/login, lista/detalhe `/me/orders` e `GET /me/wallet`: pega pedidos `user_id` nulo pelo e-mail ou CPF.
- Sessões **in-memory** no processo Node (não persistidas em DB) — reinício do server invalida tokens.
- Tenant da sessão = tenant resolvido no registro/login **ou** o `tenantId` do `customer_users` na impersonação admin.
- Impersonar (`POST /api/admin/customers/:id/impersonate`): `hasGlobalAccess`. A filial só abre cliente do próprio tenant; id de outra loja ou inexistente responde 404, sem token. O superadmin (`isPrimary`) continua podendo abrir cliente de outra loja. Seller-scoped 403. A nova aba abre `/minha-conta/pedidos#customerToken=…` (hash, não query); o FE grava em `sessionStorage` e tira o hash. `/auth/me` usa o tenant da sessão com o mesmo legado null/vazio da loja 1.
- Vendedores (`POST /api/admin/sellers`): o slug continua sendo chave global. Se a linha é de outra loja, a resposta é 409 e WhatsApp/comissão não mudam, inclusive quando dois saves chegam juntos. A mesma loja ainda atualiza o próprio slug. Linha antiga com tenant vazio conta como loja 1. Seller-scoped continua sem este CRUD.
- Redefinir senha (`PATCH /api/admin/customers/:id/password`): só `hasGlobalAccess`; cliente do próprio `tenantId`; mínimo 8; PBKDF2 + salt novos; `removeCustomerSessionsForUser`. Id `guest:<email>` abre a conta na loja (pedidos guest grudam) e só então grava a senha. Sem pedido desse e-mail na loja: 404. Seller-scoped 403. FE: botão **Alterar senha** na aba Clientes (mesmo `isPrimary` do impersonar), também no convidado. Log só `customerId` + admin, sem a senha. Conta aberta pelo saldo fica com salt `nopass:` até **Criar conta** ou este PATCH.

## Site / payment password gate

- FE: `SitePasswordGate` / `PaymentPasswordGate` — barreira de acesso ao site/link, **não** é auth admin/customer.

## Checkout security

- Token efêmero: FE `getCheckoutToken` → `GET /api/security/checkout-token`.
- Flags env: `SECURITY_ORIGIN_ENFORCE`, `SECURITY_REQUIRE_CHECKOUT_TOKEN_SECRET`.

## Isolamento multi-tenant

- Público: host → `tenants.domain` → `tenantId`. Sem match, `tenant_loja1` só se o host/origin for da loja principal (`MAIN_STORE_DOMAINS`), localhost, `*.vercel.app`, `*.ondigitalocean.app`, ou se não houver host. Qualquer outro domínio: `null` e a rota pública responde 404 `store_not_configured`. Admin não usa esse fallback: a loja vem da sessão.
- Admin: escopo por tenant + seller; primary gerencia tenants (`routes/tenants.ts`).
- Queries: muitos `or(eq(tenantId), isNull, eq(""))` para loja1 legado.

## Invariantes práticas para agentes

- Nunca expor dados de outro tenant/seller em listagens admin.
- Endpoints “globais” (produtos master, settings sensíveis, tenants, inventory overview, etc.) → verificar se exigem primary.
- Não “promover” seller-scoped a primary no código sem pedido explícito.
