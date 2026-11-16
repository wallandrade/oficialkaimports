import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express, { Router, type Express } from "express";
import {
  registerReservationLookup,
  type ReservationLookupCriteria,
  type ReservationLookupDeps,
  type ReservationLookupRow,
} from "./raffle-reservation-lookup";

const PHONE = "11999991234";
const CPF = "529.982.247-25";

function row(overrides: Partial<ReservationLookupRow> = {}): ReservationLookupRow {
  const now = Date.now();
  return {
    id: "res-1",
    raffleId: "rifa-1",
    numbers: "[3,7]",
    clientName: "Ana",
    clientPhone: PHONE,
    clientEmail: "ana@example.test",
    clientDocument: "52998224725",
    totalAmount: "20.00",
    status: "reserved",
    expiresAt: new Date(now + 60_000),
    createdAt: new Date(now - 60_000),
    pixCode: "00020126",
    pixBase64: null,
    pixExpiresAt: new Date(now + 60_000),
    transactionId: "tx-1",
    ...overrides,
  };
}

async function withLookup(
  deps: ReservationLookupDeps,
  run: (base: string) => Promise<void>,
): Promise<void> {
  const router = Router();
  registerReservationLookup(router, deps);
  const app: Express = express();
  app.use(express.json());
  app.use("/api", router);
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("sem porta");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

async function call(base: string, method: "GET" | "POST", path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) as unknown : null };
}

test("GET e POST encontram a mesma reserva", async () => {
  const seen: ReservationLookupCriteria[] = [];
  const sample = row();
  await withLookup({
    requireTenant: async () => "tenant_loja1",
    findRows: async (_tenantId, criteria) => {
      seen.push(criteria);
      return [sample];
    },
    findTitles: async () => ({ "rifa-1": "Rifa teste" }),
  }, async (base) => {
    const query = `query=${encodeURIComponent(PHONE)}&raffleId=rifa-1`;
    const viaGet = await call(base, "GET", `/api/raffles/reservations/lookup?${query}`);
    const viaPost = await call(base, "POST", "/api/raffles/reservations/lookup", {
      query: PHONE,
      raffleId: "rifa-1",
    });

    assert.equal(viaGet.status, 200);
    assert.equal(viaPost.status, 200);
    assert.deepEqual(viaGet.json, viaPost.json);
    assert.deepEqual(seen[0], { lookupPhone: PHONE, lookupCpf: "", raffleId: "rifa-1" });
    assert.deepEqual(seen[0], seen[1]);

    const body = viaPost.json as Array<Record<string, unknown>>;
    assert.equal(body.length, 1);
    assert.deepEqual(body[0]?.numbers, [3, 7]);
    assert.equal(body[0]?.raffleTitle, "Rifa teste");
    assert.equal(body[0]?.isExpired, false);
    assert.equal(body[0]?.isPixExpired, false);
    assert.equal(body[0]?.clientPhone, PHONE);
  });
});

test("GET e POST tratam telefone formatado e CPF do mesmo jeito", async () => {
  const seen: Array<{ method: string; criteria: ReservationLookupCriteria }> = [];
  await withLookup({
    requireTenant: async () => "tenant_loja1",
    findRows: async (_tenantId, criteria) => {
      seen.push({ method: "both", criteria });
      return [];
    },
    findTitles: async () => ({}),
  }, async (base) => {
    const formatted = "(11) 99999 1234";
    await call(base, "GET", `/api/raffles/reservations/lookup?query=${encodeURIComponent(formatted)}`);
    await call(base, "POST", "/api/raffles/reservations/lookup", { query: formatted });
    assert.deepEqual(seen[0]?.criteria, { lookupPhone: "11999991234", lookupCpf: "", raffleId: "" });
    assert.deepEqual(seen[0]?.criteria, seen[1]?.criteria);

    const withHyphen = "(11) 99999-1234";
    await call(base, "GET", `/api/raffles/reservations/lookup?query=${encodeURIComponent(withHyphen)}`);
    await call(base, "POST", "/api/raffles/reservations/lookup", { query: withHyphen });
    assert.deepEqual(seen[2]?.criteria, {
      lookupPhone: "11999991234",
      lookupCpf: "11999991234",
      raffleId: "",
    });
    assert.deepEqual(seen[2]?.criteria, seen[3]?.criteria);

    await call(base, "GET", `/api/raffles/reservations/lookup?query=${encodeURIComponent(CPF)}`);
    await call(base, "POST", "/api/raffles/reservations/lookup", { query: CPF });
    assert.deepEqual(seen[4]?.criteria, {
      lookupPhone: "52998224725",
      lookupCpf: "52998224725",
      raffleId: "",
    });
    assert.deepEqual(seen[4]?.criteria, seen[5]?.criteria);

    await call(base, "GET", "/api/raffles/reservations/lookup?phone=11988887777&cpf=390.533.447-05&raffleId=rifa-2");
    await call(base, "POST", "/api/raffles/reservations/lookup", {
      phone: "11988887777",
      cpf: "390.533.447-05",
      raffleId: "rifa-2",
    });
    assert.deepEqual(seen[6]?.criteria, {
      lookupPhone: "11988887777",
      lookupCpf: "39053344705",
      raffleId: "rifa-2",
    });
    assert.deepEqual(seen[6]?.criteria, seen[7]?.criteria);
  });
});

test("termo curto responde 400 nos dois formatos e o POST não lê a URL", async () => {
  let calls = 0;
  await withLookup({
    requireTenant: async () => "tenant_loja1",
    findRows: async () => {
      calls += 1;
      return [];
    },
    findTitles: async () => ({}),
  }, async (base) => {
    const viaGet = await call(base, "GET", "/api/raffles/reservations/lookup?query=123");
    const viaPost = await call(base, "POST", "/api/raffles/reservations/lookup", { query: "123" });
    const postIgnoringUrl = await call(
      base,
      "POST",
      `/api/raffles/reservations/lookup?query=${PHONE}`,
      {},
    );
    for (const result of [viaGet, viaPost, postIgnoringUrl]) {
      assert.equal(result.status, 400);
      assert.deepEqual(result.json, {
        error: "INVALID_INPUT",
        message: "Informe um telefone ou CPF válido.",
      });
    }
    assert.equal(calls, 0);
  });
});

test("reserva vencida e PIX vencido continuam marcados", async () => {
  const expired = row({
    expiresAt: new Date(Date.now() - 60_000),
    pixExpiresAt: null,
    status: "reserved",
  });
  await withLookup({
    requireTenant: async () => "tenant_loja1",
    findRows: async () => [expired],
    findTitles: async () => ({}),
  }, async (base) => {
    const viaGet = await call(base, "GET", `/api/raffles/reservations/lookup?query=${PHONE}`);
    const viaPost = await call(base, "POST", "/api/raffles/reservations/lookup", { query: PHONE });
    assert.deepEqual(viaGet.json, viaPost.json);
    const body = viaPost.json as Array<Record<string, unknown>>;
    assert.equal(body[0]?.isExpired, true);
    assert.equal(body[0]?.isPixExpired, true);
    assert.equal(body[0]?.raffleTitle, "Rifa");
  });
});
