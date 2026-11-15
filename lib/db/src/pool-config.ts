// mysql2 copia cada query da URI para as opções da conexão. `ssl-mode`
// (DigitalOcean manda `?ssl-mode=REQUIRED`) não é opção válida e vira aviso
// no boot. O backup em scripts/src/db-backup-r2.mjs já tirava esse parâmetro
// e ligava o TLS no objeto `ssl`. O pool faz o mesmo.

export type MysqlSslOptions = {
  ca?: string;
  rejectUnauthorized: boolean;
};

export type MysqlPoolOptionsFromUrl = {
  uri: string;
  ssl?: MysqlSslOptions;
};

const SSL_QUERY_KEYS = new Set(["ssl-mode", "sslmode"]);

export function mysqlPoolOptionsFromUrl(
  databaseUrl: string,
  caCert?: string | null,
): MysqlPoolOptionsFromUrl {
  const url = new URL(databaseUrl);
  let sslMode = "";
  for (const key of [...url.searchParams.keys()]) {
    if (!SSL_QUERY_KEYS.has(key.toLowerCase())) continue;
    if (!sslMode) sslMode = (url.searchParams.get(key) || "").trim().toUpperCase();
    url.searchParams.delete(key);
  }

  const ca = typeof caCert === "string" ? caCert.trim() : "";
  let ssl: MysqlSslOptions | undefined;
  if (ca) {
    ssl = { ca, rejectUnauthorized: true };
  } else if (sslMode && sslMode !== "DISABLED") {
    ssl = { rejectUnauthorized: false };
  }

  const options: MysqlPoolOptionsFromUrl = { uri: url.toString() };
  if (ssl) options.ssl = ssl;
  return options;
}
