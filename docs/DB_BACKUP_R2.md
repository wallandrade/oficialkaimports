# Daily MySQL backup to Cloudflare R2

`scripts/src/db-backup-r2.mjs` dumps the whole database (tables, data, views, triggers)
inside one consistent snapshot, gzips it and streams it to R2 with multipart upload
(8 MiB parts, bounded memory). It exits with code 1 on any error and aborts the
partial upload. Success log line:

```
[db-backup] ... OK kaimports-db-backups/mysql/2026-11-13_0300.sql.gz: N tables, ... gzip X MiB, sha256 ..., Ns
```

## Bucket

- `kaimports-db-backups` (private, no r2.dev / custom domain).
- Lifecycle rule `expire-30d`: objects deleted after 30 days; unfinished multipart uploads after 7 days.

## Runner: App Platform scheduled job (component of `lobster-app`)

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

`CLOUDFLARE_R2_ACCOUNT_ID`, `TZ`, `NODE_VERSION` and `NPM_CONFIG_PRODUCTION` come from the
app-level env vars. Optional: `DATABASE_CA_CERT=${kaimports-mysql.CA_CERT}` to verify the
DB TLS certificate (without it the connection is still encrypted, just not verified).

The R2 token must be an **Account API token** with **Object Read & Write** scoped
to **only** `kaimports-db-backups`.

## Run by hand

```
pnpm --filter @workspace/scripts backup:db:r2            # upload to R2 (needs the env vars above)
BACKUP_OUTPUT_FILE=/tmp/db.sql.gz node scripts/src/db-backup-r2.mjs   # local file, no upload
```

## Restore

```
gunzip -c 2026-11-13_0300.sql.gz | mysql -h HOST -P PORT -u USER -p --ssl-mode=REQUIRED DBNAME
```

The dump drops and recreates each table, so restore into an empty database (or one you
intend to overwrite). Stored procedures/functions are not included (the app has none;
the script warns if any appear).
