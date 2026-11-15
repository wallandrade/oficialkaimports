import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";

import { mysqlPoolOptionsFromUrl } from "./pool-config";

function parts(uri: string) {
  const url = new URL(uri);
  return {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    host: url.hostname,
    port: url.port,
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    queryKeys: [...url.searchParams.keys()],
  };
}

test("tira ssl-mode da URI e liga TLS sem verificar o certificado", () => {
  const options = mysqlPoolOptionsFromUrl(
    "mysql://doadmin:s3cret@db-mysql-nyc3-123.ondigitalocean.com:25060/defaultdb?ssl-mode=REQUIRED",
  );

  assert.deepEqual(parts(options.uri), {
    user: "doadmin",
    password: "s3cret",
    host: "db-mysql-nyc3-123.ondigitalocean.com",
    port: "25060",
    database: "defaultdb",
    queryKeys: [],
  });
  assert.equal(options.uri.includes("ssl-mode"), false);
  assert.deepEqual(options.ssl, { rejectUnauthorized: false });
});

test("aceita sslmode, preserva a senha e os outros parâmetros", () => {
  const options = mysqlPoolOptionsFromUrl(
    "mysql://user:p%40ss%3Aword@127.0.0.1:3306/shop?sslmode=required&charset=utf8mb4",
  );

  assert.deepEqual(parts(options.uri), {
    user: "user",
    password: "p@ss:word",
    host: "127.0.0.1",
    port: "3306",
    database: "shop",
    queryKeys: ["charset"],
  });
  assert.equal(new URL(options.uri).searchParams.get("charset"), "utf8mb4");
  assert.deepEqual(options.ssl, { rejectUnauthorized: false });
});

test("ssl-mode=DISABLED e URL local sem o parâmetro não ligam SSL", () => {
  const disabled = mysqlPoolOptionsFromUrl(
    "mysql://user:pass@Host.Example:3306/db?foo=1&SSL-MODE=disabled",
  );
  assert.equal(disabled.ssl, undefined);
  assert.equal(/ssl-?mode/i.test(disabled.uri), false);
  assert.equal(new URL(disabled.uri).searchParams.get("foo"), "1");
  assert.equal(new URL(disabled.uri).hostname, "Host.Example");

  const local = mysqlPoolOptionsFromUrl("mysql://root@localhost/oficialkaimports");
  assert.equal(local.ssl, undefined);
  assert.equal(local.uri, "mysql://root@localhost/oficialkaimports");
});

test("DATABASE_CA_CERT verifica o certificado e ainda tira o ssl-mode", () => {
  const pem = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
  const options = mysqlPoolOptionsFromUrl(
    "mysql://user:pass@db.example.com:25060/app?ssl-mode=REQUIRED",
    pem,
  );

  assert.equal(options.uri.includes("ssl-mode"), false);
  assert.deepEqual(options.ssl, { ca: pem, rejectUnauthorized: true });
});

async function poolWarnings(uri: string): Promise<string[]> {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map((part) => String(part)).join(" "));
  };
  const pool = mysql.createPool({ uri, connectionLimit: 1, waitForConnections: true });
  console.error = original;
  await pool.end();
  return errors;
}

test("o mysql2 avisa ssl-mode na URI crua e fica quieto com a URI limpa", async () => {
  const raw = "mysql://user:secret@127.0.0.1:3306/unused?ssl-mode=REQUIRED";
  const rawErrors = await poolWarnings(raw);
  assert.equal(rawErrors.some((line) => line.includes("ssl-mode")), true);

  const cleaned = mysqlPoolOptionsFromUrl(raw);
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map((part) => String(part)).join(" "));
  };
  const pool = mysql.createPool({
    ...cleaned,
    connectionLimit: 1,
    waitForConnections: true,
  });
  console.error = original;
  await pool.end();

  assert.equal(errors.some((line) => /ssl-?mode/i.test(line)), false);
  assert.equal(errors.some((line) => line.includes("invalid configuration option")), false);
});
