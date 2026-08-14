# Padrões de código — KA Imports

> **Última atualização:** 2026-08-13  
> Descreve o que *já existe no código*; não especular.

## Changelog

| Data | O quê | Impacto | O que NÃO mudou |
|------|--------|---------|-----------------|
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
- Enviar um produto × N linhas na cotação EnvioEcom (empilha altura → `QUOTE_ERROR`); usar 1 pacote + clamp.
- Setar `orders.enviado` na etiqueta EnvioEcom sem passar por `ensureOrderMarkedEnviado` (estoque/logística).
- Marcar `enviado` ao gerar etiqueta / DC-e / “Pronto para envio”; isso só na coleta/postagem da API.
- Restaurar vaga `allocated` no reconcile só porque `enviado` é false quando a etiqueta EnvioEcom já existe.
- Tratar status EnvioEcom como enum rígido (é texto livre).

## Idioma

- Respostas da IA e docs de memória: **pt-BR**.
- Código/comentários: seguir o arquivo (mistura pt/en já existe).
