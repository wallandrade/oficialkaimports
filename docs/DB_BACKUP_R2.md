# Backup diário no Cloudflare R2

O comando do job na DigitalOcean não muda:

```
node --max-old-space-size=192 scripts/src/db-backup-r2.mjs
```

Esse arquivo orquestra duas etapas. A falha de uma não pula a outra. No fim grava o heartbeat e, se algo falhou, manda um WhatsApp direto na Z-API. Sai com código 1 se o banco, a mídia ou o heartbeat falhar.

## Banco

Dump lógico do MySQL (tabelas, dados, views, triggers) num snapshot consistente, gzip e upload multipart de 8 MiB para `mysql/AAAA-MM-DD_HHMM.sql.gz`. O log de sucesso continua:

```
[db-backup] ... OK kaimports-db-backups/mysql/2026-11-13_0300.sql.gz: N tables, ... gzip X MiB, sha256 ..., Ns
```

Arquivo local, sem R2, sem mídia e sem alerta:

```
BACKUP_OUTPUT_FILE=/tmp/db.sql.gz node scripts/src/db-backup-r2.mjs
```

Restore:

```
gunzip -c 2026-11-13_0300.sql.gz | mysql -h HOST -P PORT -u USER -p --ssl-mode=REQUIRED DBNAME
```

O dump derruba e recria cada tabela. Restaure num banco vazio, ou num que pode ser sobrescrito. Procedure e function não entram (o app não tem; o script avisa se aparecer).

## Mídia

`scripts/src/media-backup-r2.mjs` espelha o bucket da loja (`CLOUDFLARE_R2_BUCKET_NAME`, hoje `oficialkaimports-media`) para `kaimports-db-backups/media/`.

- Origem: prefixos `products/`, `tracking-labels/`, `whatsapp-groups/` e `site-settings/`. ListObjects paginado.
- Destino: uma listagem só, prefixo `media/`.
- Copia só chave ausente ou com tamanho diferente. Não apaga o que já está no destino.
- Leitura com a chave `CLOUDFLARE_R2_*`. Gravação com `BACKUP_R2_*`. Get em stream e Put, ou multipart de 8 MiB quando o objeto passa disso. Quatro cópias ao mesmo tempo, para caber no heap de 192 MB.
- Origem com 0 objetos é erro. Qualquer chave que falhar encerra com código 1 e entra na conta do alerta.
- Log: `copiados`, `faltando`, `bytes`, `total`, `falhas`.

## Heartbeat e alerta

Heartbeat em `site_settings`, `tenant_id = tenant_loja1`, chave `backup_last_status`:

```json
{"dateSP":"2026-11-28","dbOk":true,"dumpKey":"mysql/2026-11-28_0300.sql.gz","dumpBytes":123,"mediaOk":true,"copied":0,"total":2634,"finishedAt":"2026-11-28T06:10:00.000Z"}
```

`backup_alert_last_date` guarda o dia em que o watchdog já avisou. As duas chaves ficam fora de `PUBLIC_KEYS`, de `ALLOWED_KEYS` e de `public-settings.ts`. A resposta de settings ainda apaga essas chaves se um dia entrarem na lista. Não mexe em linha de outra loja.

Alerta do job, só quando algo falhou: `POST /send-text` na Z-API com `ZAPI_MAIN_INSTANCE_ID`, `ZAPI_MAIN_TOKEN` e `ZAPI_CLIENT_TOKEN`. Não usa n8n nem `whatsapp_outbound_queue`. `WHATSAPP_ZAPI_DRY_RUN` não chama a rede. `WHATSAPP_ZAPI_FAKE_ONLY` só aceita número que começa com `550000`. Destinatários: `BACKUP_ALERT_PHONES` (vírgula; só dígitos, começando com 55, 12 ou 13 posições). Sem a variável, o job só escreve um aviso no log. O texto é `[Ka Imports] Backup falhou`, a etapa (`banco`, `mídia` ou `registro`), o erro em no máximo 200 caracteres e a hora de São Paulo. O log não leva telefone, SQL nem segredo.

## Watchdog na API

`startBackupWatchdogJob()` sobe com a API, no mesmo formato do job da fila de WhatsApp. A cada 30 minutos, entre 04:00 e 12:00 de `America/Sao_Paulo`, lê `backup_last_status`. Avisa se a data não é de hoje, se `dbOk` ou `mediaOk` não for verdadeiro, ou se o banco não respondeu. No máximo um aviso por dia, pela chave `backup_alert_last_date`. O envio é `sendZapiMessage` com `live: true`, direto para `BACKUP_ALERT_PHONES`. Não entra na fila.

`BACKUP_ALERT_PHONES` precisa estar no ambiente do app, não só no job: a API e o cron leem a mesma variável.

## Bucket

- `kaimports-db-backups` (privado, sem r2.dev e sem domínio próprio).
- Prefixo `mysql/` para o dump e `media/` para o espelho.
- A regra `expire-30d` hoje vale para o bucket inteiro. Antes do primeiro espelho ela tem de ficar só em `mysql/`. Do jeito que está, apagaria `media/` em 30 dias. `abort-multipart-7d` continua para upload multipart abandonado.

## Runner: job agendado do App Platform (componente de `lobster-app`)

```yaml
jobs:
  - name: db-backup-r2
    kind: SCHEDULED
    schedule:
      cron: "0 3 * * *"
      time_zone: America/Sao_Paulo
    github:
      repo: wallandrade/oficialkaimports
      branch: main
      deploy_on_push: true
    source_dir: /
    environment_slug: node-js
    build_command: CI=true pnpm install --frozen-lockfile --prod=false
    run_command: node --max-old-space-size=192 scripts/src/db-backup-r2.mjs
    instance_size_slug: apps-s-1vcpu-1gb
    instance_count: 1
    envs:
      - key: DATABASE_URL
        value: ${kaimports-mysql.DATABASE_URL}
        scope: RUN_TIME
      - key: BACKUP_R2_BUCKET
        value: kaimports-db-backups
        scope: RUN_TIME
      - key: BACKUP_R2_ACCESS_KEY_ID
        value: <R2 token Access Key ID>
        scope: RUN_TIME
        type: SECRET
      - key: BACKUP_R2_SECRET_ACCESS_KEY
        value: <R2 token Secret Access Key>
        scope: RUN_TIME
        type: SECRET
```

`CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_BUCKET_NAME`, `ZAPI_MAIN_INSTANCE_ID`, `ZAPI_MAIN_TOKEN`, `ZAPI_CLIENT_TOKEN`, `TZ`, `NODE_VERSION` e `NPM_CONFIG_PRODUCTION` vêm do ambiente do app. Opcional: `DATABASE_CA_CERT=${kaimports-mysql.CA_CERT}` para verificar o TLS do banco (sem o PEM a conexão continua cifrada, só não verifica o certificado).

O token `BACKUP_R2_*` é um token de conta com **Object Read & Write** só no bucket `kaimports-db-backups`. A chave `CLOUDFLARE_R2_*` lê o bucket da loja.

## Rodar na mão

```
pnpm --filter @workspace/scripts backup:db:r2
BACKUP_OUTPUT_FILE=/tmp/db.sql.gz node scripts/src/db-backup-r2.mjs
```

Testes:

```
pnpm --filter @workspace/scripts test:backup
pnpm --filter @workspace/api-server test:backup-watchdog
```

## Passos fora do repo (precisam do ok do dono)

Nada disso foi aplicado daqui.

1. **Cloudflare.** No bucket `kaimports-db-backups`, trocar a regra de lifecycle `expire-30d` para `prefix: mysql/` antes do primeiro espelho. Hoje ela vale para o bucket inteiro e apagaria `media/`. Manter `abort-multipart-7d`.
2. **DigitalOcean.** Adicionar `BACKUP_ALERT_PHONES` no nível do app (não só no job), com os números em dígitos, começando com 55, separados por vírgula. A API e o cron precisam enxergar a mesma variável.
3. **Opcional.** No job `db-backup-r2`, `alerts: [JOB_INVOCATION_FAILED]`, para a DigitalOcean avisar se o processo nem chegar a rodar.
