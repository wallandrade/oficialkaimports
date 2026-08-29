# Segurança e performance — KA Imports

> **Última atualização:** 2026-08-29  
> Descreve o que *já existe no código*; não especular.

## Changelog

| Data | O quê | Impacto | O que NÃO mudou |
|------|--------|---------|-----------------|
| 2026-08-29 | GET contas EnvioEcom mascara token/e-mail; senha nunca sai | Extra no JSON só no servidor | CSP / CORS / rate limit iguais |
| 2026-08-28 | Chaves APPCNPay mascaradas no GET admin; PUT `***` no-op; fora de `PUBLIC_KEYS` e `localStorage` | Segredo não vaza no browser/cache | CSP / CORS / rate limit iguais |
| 2026-08-21 | Lista admin leve + debounce na busca; data não dispara GET de stats | Menos JSON e menos rerender | CSP / CORS / rate limit iguais |
| 2026-08-16 | CSP do FE: `frame-src 'self' blob: data: https:` | Comprovante PDF no admin abre no iframe | `object-src 'none'` e `frame-ancestors 'none'` iguais |
| 2026-08-11 | Extração de hardening/ops do código | Evitar remover proteções | Sem tuning de infra |

---

## Segurança observada

- **CORS**: allowlist env `CORS_ALLOWED_ORIGINS` ou default `ka-imports.com` + hosts de tenants no DB (cache TTL) — `app.ts`.
- **Origin enforce** (flag): `SECURITY_ORIGIN_ENFORCE`.
- **Checkout token**: obrigatório conforme flags/`SECURITY_REQUIRE_CHECKOUT_TOKEN_SECRET`.
- **Admin login rate limit**: tentativas/janela/bloqueio configuráveis.
- **Cookies admin**: SameSite/Secure sensíveis a produção (`none`+`secure` típico cross-site FE/API).
- **Erros 500**: menos detalhes em produção.
- Password gates no FE (site/pagamento).
- Isolamento tenant/seller (ver `auth-permissoes.md` + smoke scripts).
- Credenciais APPCNPay da loja: GET `/api/admin/settings` mascara `gateway_appcnpay_*`; PUT com valor já mascarado não sobrescreve; FE não persiste essas keys em `siteSettings`.
- **CSP do FE** (`index.html` + `vercel.json`): `default-src 'self'`; `object-src 'none'`; `frame-ancestors 'none'`; `frame-src 'self' blob: data: https:` (comprovante PDF no admin usa iframe + blob). `img-src` já permite `data:`/`blob:`/`https:`.

## Ops / health

- `GET /healthz` → `{ status: "ok" }` (Zod `HealthCheckResponse`).
- Jobs periódicos: expiração pedidos 24h; raffle expiry; reconcile logistics no boot.
- Unhandled rejection / uncaughtException: log sem derrubar processo (`index.ts`).

## Performance / cache (código)

- Cache de hosts CORS de tenants (TTL env).
- Produtos: caminhos de cache/fallback Sheets documentados em rotas/docs de catálogo — validar no arquivo antes de “otimizar”.
- FE assets: headers long-cache em `/assets/*` no `vercel.json`; HTML `no-store`.
- Admin Pedidos: busca com debounce 300ms (estado local no input); troca de `dateFrom`/`dateTo` não chama `fetchStatsData` (stats tem intervalo próprio). `GET /admin/orders` devolve lista sem `data:` de comprovante/etiqueta e sem `trackingLabelText`; `GET /admin/orders/:id` hidrata na abertura do comprovante.
- Análise longa em `PERFORMANCE_OPTIMIZATION_ANALYSIS.md` — **não** ler por padrão; só se a tarefa for perf.

## Anti-padrões

- Remover rate limit / CORS / checkout token “para facilitar”.
- Tirar `frame-src` do CSP do FE e voltar a iframe de comprovante em `data:` (quebra o PDF no Chrome).
- Mandar comprovante/etiqueta em `data:` e OCR (`trackingLabelText`) em **toda** a lista `GET /admin/orders`; a lista é leve e o detalhe vem em `GET /admin/orders/:id`.
- Reativar polling de gateway.
- Logar tokens/senhas em claro (há redaction parcial em admin-auth).
