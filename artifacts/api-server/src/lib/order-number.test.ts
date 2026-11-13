import assert from "node:assert/strict";
import test from "node:test";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "mysql://unit:test@127.0.0.1:3306/unused";
}

const { DEFAULT_TENANT_ID } = await import("./tenant-context");
const { MAIN_STORE_ORDER_NUMBER_FLOOR, reserveNextOrderNumber } = await import("./order-number");

type SqlCapture = {
  sql: string;
  params: unknown[];
};

function flattenSql(value: unknown, sqlParts: string[], params: unknown[], inChunkList = false): void {
  if (Array.isArray(value)) {
    for (const part of value) {
      if (
        inChunkList &&
        (part === null || typeof part === "string" || typeof part === "number" || typeof part === "boolean")
      ) {
        params.push(part);
        sqlParts.push("?");
        continue;
      }
      flattenSql(part, sqlParts, params, inChunkList);
    }
    return;
  }
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return;
  if (typeof value !== "object") return;

  const obj = value as {
    queryChunks?: unknown;
    value?: unknown;
    name?: unknown;
    table?: unknown;
    encoder?: unknown;
  };

  if (Array.isArray(obj.queryChunks)) {
    flattenSql(obj.queryChunks, sqlParts, params, true);
    return;
  }
  if (Array.isArray(obj.value) && obj.value.every((part) => typeof part === "string")) {
    sqlParts.push(obj.value.join(""));
    return;
  }
  if (typeof obj.name === "string" && obj.table) {
    sqlParts.push(obj.name);
    return;
  }
  if ("encoder" in obj && "value" in obj) {
    params.push(obj.value);
    sqlParts.push("?");
  }
}

function captureSql(value: unknown): SqlCapture {
  const sqlParts: string[] = [];
  const params: unknown[] = [];
  flattenSql(value, sqlParts, params);
  return { sql: sqlParts.join(""), params };
}

function fakeTx(maxNumber: number | string | null) {
  const statements: SqlCapture[] = [];
  let where: SqlCapture | undefined;
  const tx = {
    async execute(query: unknown) {
      statements.push(captureSql(query));
      return [];
    },
    select() {
      return {
        from() {
          return {
            async where(clause: unknown) {
              where = captureSql(clause);
              return [{ maxNumber }];
            },
          };
        },
      };
    },
  };
  return {
    tx,
    statements,
    get where() {
      return where;
    },
  };
}

test("loja principal começa em 2790 quando o máximo atual é menor", async () => {
  assert.equal(MAIN_STORE_ORDER_NUMBER_FLOOR, 2789);

  for (const maxNumber of [0, 1, 100, 2788, 2789, "1500", null]) {
    const db = fakeTx(maxNumber);
    const next = await reserveNextOrderNumber(db.tx, DEFAULT_TENANT_ID);
    assert.equal(next, 2790, `max=${String(maxNumber)}`);
    assert.equal(db.statements[0]?.sql, "SELECT GET_LOCK(?, 10) AS acquired");
    assert.deepEqual(db.statements[0]?.params, [`orders_seq_${DEFAULT_TENANT_ID}`]);
    assert.equal(db.statements.at(-1)?.sql, "DO RELEASE_LOCK(?)");
    assert.deepEqual(db.statements.at(-1)?.params, [`orders_seq_${DEFAULT_TENANT_ID}`]);
    assert.match(db.where?.sql ?? "", /tenant_id = \? or tenant_id is null or tenant_id = \?/);
    assert.deepEqual(db.where?.params, [DEFAULT_TENANT_ID, ""]);
  }
});

test("loja principal segue o máximo quando ele já passou de 2789", async () => {
  const atFloor = fakeTx(2790);
  assert.equal(await reserveNextOrderNumber(atFloor.tx, "tenant_loja1"), 2791);

  const above = fakeTx("3100");
  assert.equal(await reserveNextOrderNumber(above.tx, " tenant_loja1 "), 3101);
});

test("tenant vazio conta como loja principal", async () => {
  const blank = fakeTx(12);
  assert.equal(await reserveNextOrderNumber(blank.tx, "   "), 2790);
  assert.deepEqual(blank.statements[0]?.params, ["orders_seq_tenant_loja1"]);
  assert.deepEqual(blank.where?.params, ["tenant_loja1", ""]);
});

test("filial continua em MAX+1, sem o piso da loja principal", async () => {
  for (const [maxNumber, expected] of [
    [0, 1],
    [10, 11],
    [2789, 2790],
    [2790, 2791],
    [5000, 5001],
  ] as const) {
    const db = fakeTx(maxNumber);
    const next = await reserveNextOrderNumber(db.tx, "tenant_filial_sp");
    assert.equal(next, expected, `max=${maxNumber}`);
    assert.deepEqual(db.statements[0]?.params, ["orders_seq_tenant_filial_sp"]);
    assert.equal(db.where?.sql, "tenant_id = ?");
    assert.deepEqual(db.where?.params, ["tenant_filial_sp"]);
    assert.doesNotMatch(db.where?.sql ?? "", /is null/);
  }
});

test("solta o lock se a leitura do máximo falhar", async () => {
  const statements: SqlCapture[] = [];
  const tx = {
    async execute(query: unknown) {
      statements.push(captureSql(query));
      return [];
    },
    select() {
      return {
        from() {
          return {
            async where() {
              throw new Error("db down");
            },
          };
        },
      };
    },
  };

  await assert.rejects(() => reserveNextOrderNumber(tx, "tenant_filial_sp"), /db down/);
  assert.equal(statements.at(-1)?.sql, "DO RELEASE_LOCK(?)");
  assert.deepEqual(statements.at(-1)?.params, ["orders_seq_tenant_filial_sp"]);
});
