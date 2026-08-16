# Regras de negócio — KA Imports

> **Última atualização:** 2026-08-16  
> Descreve o que *já existe no código*; não especular.

## Changelog

| Data | O quê | Impacto | O que NÃO mudou |
|------|--------|---------|-----------------|
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
- PIX dura ~15 min no gateway (`PIX_DURATION_MS` em `gateway.ts`); regeneração/expiração tratada nas rotas PIX/checkout.
- Cartão: pedido + fluxo KYC (`/kyc`, `/kyc/:orderId`); parcelas e comunicação WhatsApp no admin/FE.
- Finalizar no WhatsApp (`whatsapp_pix`): `POST /api/orders` devolve `orderNumber`; a mensagem usa `Pedido: #1841` (número sequencial), não o `id` UUID. Link KYC de cartão continua com o `id`.
- Cupons: % ou valor fixo, min. pedido, max usos, ativo/inativo.
- Seguro de frete e opções de frete (incl. motoboy com data/hora) existem no schema de pedidos e rotas de shipping/logística.
- EnvioEcom (loja 1 e filiais, admin com `hasGlobalAccess`): cotar/criar envio/gerar etiqueta PDF/webhook. Não se aplica a motoboy/retirada. Frete cobrado do cliente no checkout **não** é a cotação EnvioEcom. Cotação padrão: 1 pacote 2×12×17 cm, 0,3 kg, R$ 5. No create, `items[].name` é o setting da loja (`envioecom_shipment_item_name`, default Mercadoria), nunca o nome do produto. Create exige CPF/CNPJ (11/14 dígitos, não só zeros), telefone com DDD e e-mail com `@`; senão 400 `INVALID_RECIPIENT` sem chamar a EnvioEcom.
- Marcar `enviado` só quando o status EnvioEcom indicar coleta/postagem/trânsito (`coletado`, `postado`, `em transito`, `saiu para entrega`, `entregue`), via `ensureOrderMarkedEnviado`. Gerar etiqueta / DC-e / “Pronto para envio” **não** seta `enviado`: o card fica **Pronto para envio**, sai da fila 48/72/96h e de “Pedidos para enviar”, e a vaga vai para `shipped`. Se faltar estoque na coleta, `enviado` permanece false e **Faltando estoque** continua. Status “Entregue” pode promover pedido para `completed` se não estiver cancelado. Status **Cancelado** na EnvioEcom remove **Pronto para envio** (mesmo com PDF) e, se ainda não estiver `enviado`, devolve o pedido à fila 48/72/96h. Gerar PDF grava status **Etiqueta emitida** se ainda for “Envio criado”; o admin aborta GET atrasado e não apaga `envioecomLabelUrl` local — o card não volta a **Pendente para envio**.
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
- Cobranças custom (`custom_charges`), comprovantes múltiplos (`proofUrls`), edição de pedido: primary da loja 1 e admin de filial nos pedidos do próprio tenant (seller-scoped não edita). O PATCH grava nome, telefone, e-mail, CPF, endereço, produtos e desconto; CEP no modal preenche ViaCEP ao sair do campo. Frete e seguro não são editáveis nesse modal. Não atualiza `customer_users`.
- Busca de Pedidos é só no frontend (`search` → `filteredOrders`). Data/status/método/vendedor/grupo vão na API. Só dígitos: **somente** `orderNumber`/id do pedido (não telefone/CEP). Senão `includes` em id, número, nome, telefone, e-mail, CEP e produtos. Fora do período carregado não aparece.
- Aba **Rastreios EE**: lista pedidos com barcode/shipment_id/status EnvioEcom; Atualizar lista lê o BD; Sync consulta a API. Campo “Nome do produto no create” (até 120 chars) vale para todos os itens da loja; envios já criados não mudam.

## KYC

- Obrigatório no fluxo de cartão (aviso + envio de docs).
- Tabela `kyc_documents`; APIs públicas e admin em `routes/kyc.ts`.

## Estoque / reenvios / logística

- Saldos e movimentos (`inventory_*`); entradas admin em `reshipments.ts`. Busca de produto na entrada, reenvio manual e “produto voltando” mostra a foto do catálogo (mesmo thumbnail do saldo). No **Saldo atual por produto**, clicar na miniatura abre a foto em zoom (Esc ou clique fora fecha). A lista mostra saldo **positivo primeiro**, depois 0, e dentro de cada grupo ordena por nome.
- Reenvios manuais/automáticos, retornos, alocações de logística, reservas motoboy (CEP/bairros).
- Fila 48/72/96h só conta alocações `allocated`. Pedido com PDF EnvioEcom ou status de etiqueta/trânsito não volta para `allocated` no reconcile só porque `enviado` ainda é false. Exceção: status EnvioEcom **Cancelado** (e ainda não `enviado`) devolve à fila.

## Rifas

- Tabelas `raffles`, `raffle_reservations`, `raffle_results`, `raffle_promotions`.
- Job de expiração: `raffle-expiry.ts`.
- Páginas FE: `/rifas`, `/rifas/:id`, `/rifas/pix/:id`, `/rifas/consulta`.

## Cliente final

- Conta: `/login`, `/minha-conta/pedidos` (customer auth Bearer in-memory no processo do server). O card de Meus pedidos mostra `orderNumber` (#1831), não o UUID; fallback no `id` só se não houver número. WhatsApp de suporte do card usa o mesmo número. APIs de tracking/detalhe continuam com `id`.
- Rastreio EnvioEcom na Minha conta: a **Situação**, o bloco Envio/Rastreio e os títulos do histórico traduzem o `envioecomStatus` só na tela (`toCustomerFriendlyShippingLabel`): Pronto para envio / etiqueta / processando / DC-e / envio criado / aguardando postagem → “Estamos embalando seu pedido” + hint “Em breve ele será despachado…”. Aguardando pagamento → “Preparando envio”; saiu para entrega/em rota → “Saiu para entrega”; entregue → “Entregue”; demais textos originais. Admin e colunas `envioecom_*` continuam com o status técnico. Eventos do `status_history` aparecem no card (`location` e descrição técnica), **mais recente no topo** (ordena por `at`); `POST /api/me/orders/tracking-sync` ao abrir a lista e a cada ~2 min nos abertos; botão Atualizar rastreio chama `GET /api/me/orders/:id/tracking`.
- Senha de site / payment gate no FE (`SitePasswordGate`) — não confundir com auth admin.

## Decisões pendentes

- Nenhuma autorizada nesta baseline. Novas regras de negócio fora do código devem ser confirmadas com humano antes de entrar aqui.
