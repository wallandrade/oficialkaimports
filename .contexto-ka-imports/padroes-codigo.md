# Padrões de código — KA Imports

> **Última atualização:** 2026-08-18  
> Descreve o que *já existe no código*; não especular.

## Changelog

| Data | O quê | Impacto | O que NÃO mudou |
|------|--------|---------|-----------------|
| 2026-08-18 | Anti-padrão: tratar flag de extrato OFX como “pago” do gateway | Só `bank_deposit_*`; paid continua webhook/manual | Polling PIX inalterado |
| 2026-08-17 | Anti-padrão: manter `PRIORIDADE URGENTE` em pedido já `enviado` | Zerar `is_prioridade` no envio/coleta; esconder no card | SLA 48h e botão em não enviados inalterados |
| 2026-08-17 | Anti-padrão: tratar `costPrice: 0` no item do pedido como snapshot válido | 0 = sem custo; preencher no save do produto; card usa a ficha | Pedidos com custo > 0 fora de 24h inalterados |
| 2026-08-17 | Anti-padrão: `window.prompt` para ID EnvioEcom | Modal Vincular EE + parser ID vs rastreio | bind-id antigo permanece |
| 2026-08-16 | Anti-padrão: iframe de comprovante PDF em `data:` com CSP sem `frame-src` | Converter para blob + `frame-src blob: data: https:` | `object-src 'none'` inalterado |
| 2026-08-16 | Anti-padrão: PATCH de reenvio debitar estoque em qualquer status | Só debitar em `reenvio_enviado`; cancelar não baixa | Schema `reshipments.status` inalterado (varchar) |
| 2026-08-16 | Anti-padrão: saldo de estoque misturar 0 un no topo da lista | Positivo primeiro, depois nome | API de inventário inalterada |
| 2026-08-16 | Anti-padrão: `.reverse()` no histórico EnvioEcom (API já vem newest-first) | Ordenar por `at` desc na Minha conta | Persistência do histórico inalterada |
| 2026-08-16 | Anti-padrão: mostrar “Pronto para envio” / “Etiqueta emitida” na Minha conta | Traduzir só no FE do cliente; admin fica técnico | Status EnvioEcom no BD inalterado |
| 2026-08-16 | Anti-padrão: miniatura do saldo de estoque sem zoom | Clique abre lightbox (igual pedidos) | API de inventário inalterada |
| 2026-08-16 | Anti-padrão: `datalist` nativo na busca de estoque (sem foto) | Combobox com `products[].image` igual ao saldo | API de inventário inalterada |
| 2026-08-16 | Anti-padrão: UUID no card da Minha conta (`#{order.id}`) | Usar `orderNumber` como o admin | Rotas `/me/orders/:id` inalteradas |
| 2026-08-16 | Anti-padrão: create EnvioEcom com CPF `000.000.000-00` e 400 sem log/`details` | Validar destinatário; logar erro; toast com `details` | Cotação/etiqueta inalteradas |
| 2026-08-15 | Anti-padrão: editar pedido só com nome/endereço/itens e deixar telefone/e-mail/CPF só no card | `PATCH /admin/orders/:id/edit` persiste contato | Frete/seguro e conta do cliente inalterados |
| 2026-08-15 | Anti-padrão: esconder “Editar Pedido” da filial com `isPrimary` | Usar `hasGlobalAccess` / tenant da loja; pedidos já são por tenant | Seller-scoped da loja 1 inalterado |
| 2026-08-15 | Anti-padrão: impersonar cliente sem `tenantId` na sessão e gravar token só no `localStorage` da aba admin | Sessão com tenant do cliente + hash na aba nova | Login normal do cliente inalterado |
| 2026-08-15 | Anti-padrão: inventar evento “Status atualizado ao consultar rastreio” ou esconder o histórico EnvioEcom só no modal | Persistir `status_history` com `location`; timeline no card | Soft-sync GET tracking permanece |
| 2026-08-15 | Anti-padrão: UUID do pedido na mensagem WhatsApp do checkout | Usar `orderNumber` sequencial | KYC URL continua com `id` |
| 2026-08-14 | Anti-padrão: enviar `p.name` do catálogo em `items[].name` no create EnvioEcom | Usar o setting genérico da loja (default Mercadoria) | Cotação inalterada |
| 2026-08-13 | Anti-padrão: cotar EnvioEcom com caixa 10×15×20 e valor = total do pedido | Usar 2×12×17, 0,3 kg, R$ 5 | Stack inalterada |
| 2026-08-13 | Anti-padrão: marcar `enviado` ao gerar etiqueta/DC-e EnvioEcom | Enviado só na coleta/postagem | Stack inalterada |
| 2026-08-13 | Anti-padrão: recolocar na fila 48/72/96h pedido com etiqueta EnvioEcom só porque falta estoque | Vaga some na etiqueta; `enviado` continua com baixa de estoque | Stack inalterada |
| 2026-08-13 | Anti-padrões EnvioEcom (token no front, barcode EC, N linhas na cotação, enviado sem estoque) | Evitar erros de produção já vistos | Stack inalterada |
| 2026-08-11 | Política: agente deve incrementar a memória após mudanças relevantes | Sync contínuo código↔contexto | Stack/padrões de runtime inalterados |
| 2026-08-11 | Baseline de convenções observadas | Guia FE/BE/DB | Nenhum refactor |

## Precedência

Código > memória > suposições.

---

## Monorepo / TypeScript

- Package manager: **pnpm** (`packageManager: pnpm@9.15.9`).
- Workspace: `artifacts/*`, `lib/*`, `scripts`.
- Catalog de deps compartilhado em `pnpm-workspace.yaml`.
- Typecheck: root `pnpm run typecheck` (+ `tsc --build` libs).
- Prefixo de pacotes: `@workspace/*`.

## Backend (Express)

- Rotas em `artifacts/api-server/src/routes/*.ts`, agregadas em `routes/index.ts`.
- Helpers de domínio em `src/lib/*`.
- Middleware customer em `src/middlewares/*`; admin auth exportado de `routes/admin-auth.ts`.
- Tenant: sempre considerar `resolvePublicTenantId` / `adminScope.tenantId` e helpers `build*TenantWhere` (legado null = loja1).
- Validação: Zod (`zod/v4` em vários schemas Drizzle; catalog também tem zod 3 — **seguir o padrão do arquivo tocado**).
- Erros: JSON `{ error, message }` (e `details` fora de produção em alguns pontos).
- Testes pontuais: `node --test` + tsx (ex.: `free-shipping.test.ts`, `order-logistics.test.ts`).

## Database (Drizzle / MySQL)

- Tabelas: `mysqlTable(...)` em `lib/db/src/schema/`.
- Client: `drizzle(pool, { schema, mode: "default" })`.
- Exportar novos schemas via `schema/index.ts`.
- Preferir tipos inferidos `$inferSelect` / insert schemas drizzle-zod quando o arquivo já usa.

## Frontend (React + Vite)

- Páginas em `src/pages`, UI Radix/shadcn-like em `src/components/ui`.
- Routing: **wouter** (não React Router).
- Estado carrinho: **Zustand** + `persist`.
- Data fetching: TanStack Query via `@workspace/api-client-react` quando o endpoint está no OpenAPI; muitos fetches manuais ainda existem (admin/checkout).
- Path alias `@/` no FE.
- Estilo: Tailwind + CVA + `cn` util.

## Codegen (Orval)

- Spec: `lib/api-spec/openapi.yaml`.
- Gerar: `pnpm -C lib/api-spec run codegen`.
- **Não editar à mão** `lib/api-client-react/src/generated/**` nem `lib/api-zod/src/generated/**`.
- Mutator FE: `custom-fetch.ts`.
- OpenAPI está **incompleto** vs API real — novas rotas admin frequentemente só no Express + fetch manual.

## Commits / escopo de agente

- Não commit sem pedido explícito do humano.
- Escopo da tarefa de código: só o pedido; **exceto** atualização de `.contexto-ka-imports/` (e rules, se a política mudar) quando a mudança for relevante.

## Manutenção da memória viva

- **Sempre incrementar** `.contexto-ka-imports/` após feature/fix/refactor que mude regra de negócio, arquitetura, auth, integração, schema, segurança ou padrão de código.
- Incluir changelog + data no arquivo tocado; só fatos já no código.
- Documentar erros/anti-padrões descobertos para não repetir.
- **Pular update** só se não houver impacto de contexto (typo, formatação, etc.) e declarar isso na resposta.

## Anti-padrões (não reintroduzir)

- Assumir PostgreSQL / Prisma / Next / Nest.
- Polling de status no gateway APPCNPay (bloqueado; usar webhook + BD local).
- Tratar `mockup-sandbox` como app de produção.
- Editar clients Orval gerados.
- Ler dumps/gerados/docs longos em toda tarefa.
- Confundir seller ↔ afiliado, pedido ↔ custom charge, tenant ↔ cliente.
- Inventar NF-e/fiscal sem evidência no código.
- Chamar EnvioEcom do browser / expor `X-Partner-Token` no FE.
- Gerar etiqueta EnvioEcom com barcode provisório `EC…` (usar `shipping_id` / `ids`).
- Pedir ID EnvioEcom com `window.prompt`; usar o modal **Vincular EE** (ID 4–10 dígitos ou rastreio) e `POST .../sync`.
- Enviar um produto × N linhas na cotação EnvioEcom (empilha altura → `QUOTE_ERROR`); usar 1 pacote.
- Cotar EnvioEcom com caixa 10×15×20 e valor declarado = total do pedido; o simulador usa 2×12×17, 0,3 kg, R$ 5.
- Enviar o nome real do produto (`p.name` / catálogo) em `items[].name` no create EnvioEcom; usar `envioecom_shipment_item_name` (default Mercadoria).
- Setar `orders.enviado` na etiqueta EnvioEcom sem passar por `ensureOrderMarkedEnviado` (estoque/logística).
- Marcar `enviado` ao gerar etiqueta / DC-e / “Pronto para envio”; isso só na coleta/postagem da API.
- Restaurar vaga `allocated` no reconcile só porque `enviado` é false quando a etiqueta EnvioEcom já existe.
- Tratar PDF da etiqueta EnvioEcom como “Pronto para envio” se o status for **Cancelado**.
- Colocar o UUID do pedido (`orders.id`) na mensagem WhatsApp do checkout ou no card da Minha conta; usar `orderNumber`.
- Tratar status EnvioEcom como enum rígido (é texto livre).
- Inventar histórico de rastreio EnvioEcom (ex. “Status atualizado ao consultar rastreio”); usar `status_history` da API, com `location` cidade/unidade, e não duplicar `description` igual ao status.
- No `fetchOrders` do admin, substituir a lista com um GET iniciado antes de gerar a etiqueta (apaga o PDF na tela). Abortar o request anterior e não limpar `envioecomLabelUrl` local.
- Impersonar cliente sem `tenantId` na sessão (`/auth/me` 404 → tela de login) ou gravar o token só no `localStorage` da aba do admin.
- Esconder “Editar Pedido” da filial com `isPrimary`; pedidos já são isolados por tenant — usar `hasGlobalAccess` (primary e admin de filial).
- Editar pedido sem persistir telefone, e-mail e CPF (`clientPhone` / `clientEmail` / `clientDocument`); não são só o card.
- Enviar CPF placeholder `000.000.000-00` no create EnvioEcom, ou devolver 400 da EnvioEcom sem logar `message`/`details` e sem juntar `details` no toast.
- Usar `<datalist>` nativo na busca de produto do estoque (não mostra foto); usar combobox com `products[].image` igual ao saldo.
- Miniatura no **Saldo atual por produto** só como `<img>` sem clique; usar zoom/lightbox para identificar a embalagem.
- Listar saldo de estoque só por nome, misturando 0 un no topo; positivo primeiro, zeros no fim.
- Debitar estoque no PATCH de reenvio fora de `reenvio_enviado`, ou não ter **Cancelar Reenvio** para quem não vai mais enviar (`reenvio_cancelado`). “Cancelar Reenvio Enviado” é só o undo do enviado.
- Marcar pedido `paid` a partir do OFX, ou baixar PDF do Inter para `proofUrl`; conciliação só grava `bank_deposit_*`.
- Manter selo **PRIORIDADE URGENTE** depois de `enviado`/coletado; zerar `is_prioridade` no envio e não exibir a estrela.
- Tratar `costPrice: 0` no JSON do pedido como custo real (`!= null`); 0/ausente cai na ficha, e o PATCH do produto só preenche esses itens (além da janela de 24h).
- Abrir comprovante PDF no admin com `<iframe src="data:application/pdf...">` sem `frame-src blob:` no CSP; converter data URL para blob.
- Mostrar status técnico EnvioEcom (“Pronto para envio”, “Etiqueta emitida”) na Minha conta; traduzir só na UI do cliente (`isPackingBeforePostStatus` / `toCustomerFriendlyShippingLabel`). Admin e banco ficam iguais.
- Fazer `.reverse()` cego no `status_history` da EnvioEcom na Minha conta (a API já vem newest-first); ordenar por `at` desc.

## Idioma

- Respostas da IA e docs de memória: **pt-BR**.
- Código/comentários: seguir o arquivo (mistura pt/en já existe).
