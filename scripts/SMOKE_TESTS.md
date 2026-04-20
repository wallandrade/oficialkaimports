# Tenant Isolation Smoke Tests

Scripts para validar o isolamento multi-tenant entre admins escopados (seller-scoped) e super-admins (primary).

## Scripts

### 1. Read-Only Tests
```bash
pnpm -C scripts run smoke:tenant
```

Valida acesso a endpoints de **leitura**:
- Endpoints "primary-only" (devem retornar **403** para scoped admins)
  - /api/admin/products
  - /api/admin/settings
  - /api/admin/sellers
  - /api/admin/inventory/overview
  - /api/admin/raffles
  - (+ outros)

- Endpoints seller-scoped (devem retornar **200** para ambos os papéis)
  - /api/admin/orders
  - /api/admin/custom-charges
  - /api/admin/kyc
  - /api/admin/support-tickets
  - /api/admin/customers
  - /api/admin/reshipments
  - (+ outros)

- Validação de bloqueio cross-seller
  - Scoped admins não podem listar pedidos/financeiro de outro seller

**Variáveis de ambiente:**
```bash
API_BASE_URL=http://localhost:3000              # URL da API (obrigatório)
PRIMARY_ADMIN_TOKEN=<jwt_token_primary>         # Token super-admin (obrigatório)
SCOPED_ADMIN_TOKEN=<jwt_token_scoped>           # Token admin escopado (obrigatório)
FOREIGN_SELLER_CODE=<code_outro_seller>         # Opcional: outro seller para teste cross-seller
```

**Exemplo:**
```bash
API_BASE_URL=http://localhost:3000 \
  PRIMARY_ADMIN_TOKEN=eyJhbGc... \
  SCOPED_ADMIN_TOKEN=eyJhbGc... \
  FOREIGN_SELLER_CODE=seller_xyz \
  pnpm -C scripts run smoke:tenant
```

### 2. Write Tests with Rollback
```bash
pnpm -C scripts run smoke:tenant:write
```

Valida acesso a endpoints de **leitura e escrita** com rollback automático:
- Testes de PATCH/POST
- Auto-cleanup: dados modificados são revertidos após o teste
- Valida que operações de escrita respeitam escopo do seller

**Variáveis de ambiente:**
```bash
API_BASE_URL=http://localhost:3000              # URL da API (obrigatório)
PRIMARY_ADMIN_TOKEN=<jwt_token_primary>         # Token super-admin (obrigatório)
SCOPED_ADMIN_TOKEN=<jwt_token_scoped>           # Token admin escopado (obrigatório)
SCOPED_SELLER_CODE=<code_seller_do_scoped>     # Seller do admin escopado (opcional, ativa write tests)
TEST_ORDER_ID=<order_id>                        # ID de pedido para testes (opcional, ativa write tests)
TEST_CHARGE_ID=<charge_id>                      # ID de cobrança para testes (opcional, ativa write tests)
FOREIGN_SELLER_CODE=<code_outro_seller>         # Opcional: outro seller para teste cross-seller write
```

**Exemplo:**
```bash
API_BASE_URL=http://localhost:3000 \
  PRIMARY_ADMIN_TOKEN=eyJhbGc... \
  SCOPED_ADMIN_TOKEN=eyJhbGc... \
  SCOPED_SELLER_CODE=seller_abc \
  TEST_ORDER_ID=order_123 \
  TEST_CHARGE_ID=charge_456 \
  pnpm -C scripts run smoke:tenant:write
```

## Interpretando Resultados

### PASS
Indica que a resposta da API foi um dos status esperados (200, 403, etc.).

```
PASS [primary] Products list (primary) -> 200
PASS [scoped] Products list (scoped) -> 403
```

### FAIL
Indica que a API retornou um status diferente do esperado.

```
FAIL [scoped] Products list (scoped) -> got 500, expected one of [403]
FAIL [primary] Cross-seller orders filter (primary) -> Missing token for role 'primary'
```

## Casos de Teste Cobertos

### Leitura (Read-Only)

1. **Primary-Only Access**
   - Products, Settings, Sellers, Inventory Overview, Raffles (admin)
   - ✅ Primary admins → 200
   - ✅ Scoped admins → 403

2. **Seller-Scoped Access**
   - Orders, Custom Charges, KYC, Support Tickets, Customers, Reshipments
   - ✅ Primary admins → 200
   - ✅ Scoped admins → 200

3. **Cross-Seller Blocking** (se FOREIGN_SELLER_CODE fornecido)
   - Listar pedidos com filter sellerCode de outro seller
   - ✅ Primary admins → 200
   - ✅ Scoped admins → 403/400

### Escrita (Write + Rollback)

1. **Modificação Próprio Seller** (se TEST_ORDER_ID/TEST_CHARGE_ID fornecidos)
   - PATCH /api/admin/orders/:id/observation
   - PATCH /api/admin/custom-charges/:id/observation
   - ✅ Scoped admin → 200 + rollback automático
   - ✅ Primary admin → 200 + rollback automático

2. **Bloqueio Cross-Seller Write** (se FOREIGN_SELLER_CODE fornecido)
   - PATCH com sellerCode de outro seller
   - ✅ Scoped admin → 403/400/404

## Troubleshooting

### "Missing API_BASE_URL env var"
Adicione a variável:
```bash
export API_BASE_URL=http://localhost:3000
```

### "Missing token for role"
Verifique que ambos os tokens foram fornecidos:
```bash
export PRIMARY_ADMIN_TOKEN=<seu_token_primary>
export SCOPED_ADMIN_TOKEN=<seu_token_scoped>
```

### "got 401, expected one of [200, 403]"
Tokens inválidos ou expirados. Regenere tokens na admin page do sistema.

### "FAIL [scoped] ... -> got 200, expected one of [403]"
Segurança não está ativa: a rota ainda está acessível para scoped admins quando deveria estar bloqueada.
Verifique que o backend foi compilado/reiniciado com a build mais recente.

## Como Obter Tokens para Testes

1. **No Admin Panel:**
   - Faça login como super-admin
   - Token é armazenado em `localStorage.adminToken`
   - Abra DevTools (F12) → Console:
     ```javascript
     localStorage.getItem('adminToken')
     ```

2. **Via API (POST /api/admin/login):**
   ```bash
   curl -X POST http://localhost:3000/api/admin/login \
     -H "Content-Type: application/json" \
     -d '{"username": "admin_user", "password": "senha"}'
   ```

## Notas

- **Dados de Teste Seguros:** Write tests apenas modificam observações (não operações críticas).
- **Cleanup Automático:** Todas as mudanças são revertidas ao final do teste.
- **Sem Efeitos Colaterais:** É seguro rodar os testes contra prod/staging (com cuidado!).
- **Tolerância de Erros:** Scripts aceitam respostas 400/404 como "esperado" para alguns testes (tentativa de acesso inválido).

## Links Relacionados

- Implementação de escopo admin: `artifacts/api-server/src/routes/admin-auth.ts`
- Enforce de escopo em rotas críticas: `artifacts/api-server/src/routes/orders.ts`, `custom-charges.ts`, `kyc.ts`, etc.
- UI conditioning: `artifacts/ka-imports/src/pages/Admin.tsx`
