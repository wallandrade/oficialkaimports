# Regras de negócio — KA Imports

> **Última atualização:** 2026-08-13  
> Descreve o que *já existe no código*; não especular.

## Changelog

| Data | O quê | Impacto | O que NÃO mudou |
|------|--------|---------|-----------------|
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
- PIX dura ~15 min no gateway (`PIX_DURATION_MS` em `gateway.ts`); regeneração/expiração tratada nas rotas PIX/checkout.
- Cartão: pedido + fluxo KYC (`/kyc`, `/kyc/:orderId`); parcelas e comunicação WhatsApp no admin/FE.
- Cupons: % ou valor fixo, min. pedido, max usos, ativo/inativo.
- Seguro de frete e opções de frete (incl. motoboy com data/hora) existem no schema de pedidos e rotas de shipping/logística.
- EnvioEcom (loja 1 e filiais, admin com `hasGlobalAccess`): cotar/criar envio/gerar etiqueta PDF/webhook. Não se aplica a motoboy/retirada. Frete cobrado do cliente no checkout **não** é a cotação EnvioEcom.
- Marcar `enviado` na etiqueta pronta / trânsito / PDF gerado reutiliza baixa de estoque (`ensureOrderMarkedEnviado`). Se o estoque faltar, a vaga de expedição mesmo assim vai para `shipped` (`completeOrderLogistics`) e o pedido some de Envios 48/72/96h; `enviado` permanece false. Status EnvioEcom “Entregue” pode promover pedido para `completed` se não estiver cancelado.
- Crédito de afiliado pode zerar o valor a pagar (`paymentMethod: affiliate_credit`, `status: paid` quando `payableAmount <= 0`).

## Catálogo

- Fonte principal: tabela `products` (MySQL/Drizzle).
- Fallback documentado no código: Google Sheets se DB vazio (`products.ts`).
- Flags: `isActive`, `isSoldOut`, `isLaunch`, promo com `promoPrice`/`promoEndsAt`, desconto por volume (`bulkDiscountTiers`), variantes (`variantGroups`).
- Imagens: URL pública R2/CDN; base64 legado ainda suportado na migração.

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
- Cobranças custom (`custom_charges`), comprovantes múltiplos (`proofUrls`), edição de pedido (regras de permissão no admin).

## KYC

- Obrigatório no fluxo de cartão (aviso + envio de docs).
- Tabela `kyc_documents`; APIs públicas e admin em `routes/kyc.ts`.

## Estoque / reenvios / logística

- Saldos e movimentos (`inventory_*`); entradas admin em `reshipments.ts`.
- Reenvios manuais/automáticos, retornos, alocações de logística, reservas motoboy (CEP/bairros).
- Fila 48/72/96h só conta alocações `allocated`. Pedido com PDF EnvioEcom ou status de etiqueta/trânsito não volta para `allocated` no reconcile só porque `enviado` ainda é false.

## Rifas

- Tabelas `raffles`, `raffle_reservations`, `raffle_results`, `raffle_promotions`.
- Job de expiração: `raffle-expiry.ts`.
- Páginas FE: `/rifas`, `/rifas/:id`, `/rifas/pix/:id`, `/rifas/consulta`.

## Cliente final

- Conta: `/login`, `/minha-conta/pedidos` (customer auth Bearer in-memory no processo do server).
- Rastreio EnvioEcom na Minha conta: situação usa `envioecomStatus` se existir; modal Rastrear faz soft-sync em `GET /api/me/orders/:id/tracking`.
- Senha de site / payment gate no FE (`SitePasswordGate`) — não confundir com auth admin.

## Decisões pendentes

- Nenhuma autorizada nesta baseline. Novas regras de negócio fora do código devem ser confirmadas com humano antes de entrar aqui.
