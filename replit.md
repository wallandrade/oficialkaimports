# Workspace

## Overview

pnpm workspace monorepo using TypeScript. KA Imports e-commerce fullstack application.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite, Tailwind CSS, Zustand, React Query, Framer Motion

## KA Imports E-commerce

### Features
- Home com grid de produtos por categoria (dados DB → Google Sheets → fallback estático)
- Carrinho lateral (Zustand + localStorage)
- Checkout com formulário, frete, seguro (+10%), cupons de desconto, CEP auto-fill
- Pagamento PIX: QR Code, timer 15min, regeneração de PIX expirado (salva `pixOrderData` em localStorage)
- Pagamento cartão: simulação, até 3x ou parcelamento via WhatsApp + **fluxo KYC integrado** (aviso antes das parcelas, link de KYC após criação do pedido)
- Verificação de pagamento automática (polling a cada 5s via SSE)
- Links de vendedor (`/beatriz`, `/kaique`) com tracking em localStorage
- Webhook universal (`/api/webhook`) + webhook PIX específico (`/api/webhook/pix`)

### Admin Panel (`/admin`)
- Login com dois admins: primário (Beatriz) e secundário (Kaique) via ADMIN_USERNAME/ADMIN_PASSWORD env vars
- **Pedidos**: lista de todos os pedidos, filtros por status/método/vendedor/data, CSV export
- **Links Pagamento**: cobranças customizadas, geração de link único de pagamento
- **Vendedores**: links de rastreamento por vendedor
- **Cupons**: CRUD de cupons (% ou valor fixo), limite de usos, valor mínimo — apenas admin primário cria/apaga
- **Produtos**: CRUD completo — nome, descrição, categoria, unidade, preço regular, preço promocional com expiração automática, imagem (base64, upload local), ativação/desativação, ordem de exibição
- **Usuários**: gerenciamento de admins (apenas primário)
- **Webhook**: URL universal + URL PIX com instruções de configuração
- **Comprovante múltiplo**: galeria de thumbnails por pedido/cobrança (campo `proofUrls` JSON array no DB); cada upload ANEXA ao array sem apagar os anteriores
- **Edição de pedido** (apenas admin primário): troca de produtos, ajuste de quantidades, recalcula subtotal + total em tempo real
- **PIX de diferença**: ao editar um pedido com aumento de valor, abre modal para gerar PIX do valor diferencial via APPCNPay (QR + código copia-e-cola)
- **WhatsApp cartão com intro**: mensagem de pedido cartão prepends "Olá *Nome*, dando continuidade ao seu pedido no *cartão*..." antes dos detalhes
- SSE para notificações em tempo real + push notifications via Service Worker

### Environment Variables
- `GATEWAY_IDENTIFIER` (secret) - x-public-key do gateway APPCNPay
- `GATEWAY_SECRET` (secret) - x-secret-key do gateway APPCNPay
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` (secrets) - Admin primário (Beatriz)
- `ADMIN_USERNAME_2` / `ADMIN_PASSWORD_2` (secrets) - Admin secundário (Kaique)
- `WHATSAPP_NUMBER` - Número WhatsApp para suporte (5511917082244)
- `GOOGLE_SHEET_ID` - ID da planilha Google Sheets (opcional, usa produtos demo se ausente)

### Gateway APPCNPay — Comportamento Confirmado
- Endpoint de criação: `POST https://painel.appcnpay.com/api/v1/gateway/pix/receive`
- Headers: `x-public-key` (GATEWAY_IDENTIFIER), `x-secret-key` (GATEWAY_SECRET)
- Produtos NÃO enviados na payload (apenas client + amount)
- Webhook URL registrado: `https://<REPLIT_DOMAINS>/api/webhook/pix`
  - CRÍTICO: A URL é construída com `process.env.REPLIT_DOMAINS` (não dos headers HTTP)
  - Sem isso, o webhook seria enviado para URL interna inacessível
- **Polling de status BLOQUEADO**: `GET /api/v1/gateway/transactions?id=xxx` retorna 403 com `{"error":"Tentativa de polling bloqueada!"}`
  - Confirmação de pagamento funciona EXCLUSIVAMENTE via webhook
  - Job de reconciliação convertido para apenas expirar pedidos > 24h (sem chamar gateway)
  - Endpoints `/pix/status/:id` e `/custom-charges/status/:id` consultam apenas o BD local

### KYC System (Verificação de Identidade para Cartão)
- **Fluxo**: Modal KYC avisa o cliente antes de escolher parcelas → após criar pedido cartão, exibe link KYC
- **Página KYC Política** (`/kyc`): Explicação pública do processo KYC, isenta de senha de acesso
- **Página KYC Envio** (`/kyc/:orderId`): Cliente envia selfie+RG, frente do RG, assina declaração (4 passos)
- **Admin**: Botão "KYC" em cada pedido cartão → modal com link para o cliente, status, preview de fotos, download de docs, declaração imprimível, campos editáveis (produto, empresa, CNPJ)
- **DB**: Tabela `kyc_documents` com selfieUrl, rgFrontUrl, declarationSignature, campos admin, status
- **APIs**: `GET/POST /api/kyc/:orderId` (público), `GET/PATCH /api/admin/kyc/:orderId` (admin protegido)

### DB Schema (Drizzle ORM — PostgreSQL)
- `orders` — pedidos com client, products, total, status, paymentMethod, sellerCode, couponCode, proofUrl, proofUrls (JSON array), transactionId
- `kyc_documents` — documentos KYC vinculados ao orderId (selfieUrl, rgFrontUrl, declarationSignature, campos admin, status)
- `custom_charges` — cobranças customizadas com paymentLink, proofUrl, proofUrls (JSON array)
- `admin_users` — usuários admin com isPrimary flag
- `coupons` — cupons com discountType (percent/fixed), minOrderValue, maxUses, isActive
- `products` — catálogo DB: name, description, category, unit, price, promoPrice, promoEndsAt, image, isActive, sortOrder

### Google Sheets Format (colunas)
1. id, 2. nome, 3. descrição, 4. preço, 5. preço promocional, 6. imagem (URL), 7. categoria

A planilha precisa ser pública (compartilhada como "qualquer pessoa com o link pode visualizar").

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server
│   │   └── src/routes/
│   │       ├── products.ts # DB CRUD + Google Sheets + cache fallback
│   │       ├── pix.ts      # PIX generate/status/callback
│   │       ├── orders.ts   # Order creation + proof upload
│   │       ├── coupons.ts  # Coupon CRUD
│   │       ├── webhooks.ts # Universal /webhook + /webhook/pix
│   │       └── admin-auth.ts # JWT auth for admin
│   └── ka-imports/         # React frontend
│       └── src/
│           ├── pages/      # Home, Checkout, PixPayment, Success, Admin, PaymentLink, Seller
│           ├── components/ # Header, Footer, CartDrawer, ProductCard
│           └── store/      # Zustand cart store
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod validators
│   └── db/                 # Drizzle schema + DB client
└── package.json
```
