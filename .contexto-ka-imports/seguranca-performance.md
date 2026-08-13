# Segurança e performance — KA Imports

> **Última atualização:** 2026-08-11  
> Descreve o que *já existe no código*; não especular.

## Changelog

| Data | O quê | Impacto | O que NÃO mudou |
|------|--------|---------|-----------------|
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

## Ops / health

- `GET /healthz` → `{ status: "ok" }` (Zod `HealthCheckResponse`).
- Jobs periódicos: expiração pedidos 24h; raffle expiry; reconcile logistics no boot.
- Unhandled rejection / uncaughtException: log sem derrubar processo (`index.ts`).

## Performance / cache (código)

- Cache de hosts CORS de tenants (TTL env).
- Produtos: caminhos de cache/fallback Sheets documentados em rotas/docs de catálogo — validar no arquivo antes de “otimizar”.
- FE assets: headers long-cache em `/assets/*` no `vercel.json`; HTML `no-store`.
- Análise longa em `PERFORMANCE_OPTIMIZATION_ANALYSIS.md` — **não** ler por padrão; só se a tarefa for perf.

## Anti-padrões

- Remover rate limit / CORS / checkout token “para facilitar”.
- Reativar polling de gateway.
- Logar tokens/senhas em claro (há redaction parcial em admin-auth).
