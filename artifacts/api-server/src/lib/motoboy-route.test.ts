import assert from "node:assert/strict";
import test from "node:test";

import { billedKmFromDistance, haversineKm, priceForBilledKm, SE_COORDINATES } from "./motoboy-distance";
import {
  clearMotoboyRouteCacheForTests,
  motoboyRouteCacheKey,
  parseGoogleDistanceMatrixKm,
  parseOsrmDistanceKm,
  resolveMotoboyDistanceKm,
} from "./motoboy-route";

const ATIBAIA = { lat: -23.11694, lng: -46.55028 };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("parseOsrmDistanceKm lê routes[0].distance em km", () => {
  assert.equal(parseOsrmDistanceKm({ code: "Ok", routes: [{ distance: 67742 }] }), 67.742);
  assert.equal(parseOsrmDistanceKm({ code: "NoRoute", routes: [] }), null);
  assert.equal(parseOsrmDistanceKm({}), null);
});

test("parseGoogleDistanceMatrixKm lê element OK em km", () => {
  assert.equal(parseGoogleDistanceMatrixKm({
    rows: [{ elements: [{ status: "OK", distance: { value: 65200 } }] }],
  }), 65.2);
  assert.equal(parseGoogleDistanceMatrixKm({
    rows: [{ elements: [{ status: "ZERO_RESULTS" }] }],
  }), null);
});

test("cache key usa 5 casas", () => {
  const key = motoboyRouteCacheKey(
    { lat: -23.550385, lng: -46.633956 },
    { lat: -23.11694, lng: -46.55028 },
  );
  assert.equal(key, "-23.55038,-46.63396,-23.11694,-46.55028");
});

test("Sé → Atibaia Haversine ~49 km cai na faixa 31–50; rua 67,7 cai em 51–80", () => {
  const straight = haversineKm(SE_COORDINATES.lat, SE_COORDINATES.lng, ATIBAIA.lat, ATIBAIA.lng);
  assert.ok(straight > 48 && straight < 51, `haversine=${straight}`);
  const straightBand = priceForBilledKm(billedKmFromDistance(straight));
  assert.equal(straightBand.outcome, "priced");
  if (straightBand.outcome === "priced") {
    assert.equal(straightBand.price, 120);
    assert.equal(straightBand.label, "31–50 km");
  }

  const street = billedKmFromDistance(67.742);
  assert.equal(street, 68);
  const streetBand = priceForBilledKm(street);
  assert.equal(streetBand.outcome, "priced");
  if (streetBand.outcome === "priced") {
    assert.equal(streetBand.price, 150);
    assert.equal(streetBand.label, "51–80 km");
  }
});

test("resolveMotoboyDistanceKm usa OSRM quando Google não tem chave", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GOOGLE_MAPS_API_KEY;
  delete process.env.GOOGLE_MAPS_API_KEY;
  clearMotoboyRouteCacheForTests();
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey == null) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = originalKey;
    clearMotoboyRouteCacheForTests();
  });

  let called = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    called += 1;
    const url = String(input);
    assert.match(url, /router\.project-osrm\.org\/route\/v1\/driving\//);
    assert.match(url, /-46\.633956,-23\.550385;-46\.55028,-23\.11694/);
    return jsonResponse({ code: "Ok", routes: [{ distance: 67742 }] });
  }) as typeof fetch;

  const km = await resolveMotoboyDistanceKm(SE_COORDINATES, ATIBAIA);
  assert.equal(km, 67.742);
  assert.equal(called, 1);

  const cached = await resolveMotoboyDistanceKm(SE_COORDINATES, ATIBAIA);
  assert.equal(cached, 67.742);
  assert.equal(called, 1);
});

test("resolveMotoboyDistanceKm tenta Google antes do OSRM se houver chave", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = "test-key";
  clearMotoboyRouteCacheForTests();
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey == null) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = originalKey;
    clearMotoboyRouteCacheForTests();
  });

  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("maps.googleapis.com")) {
      return jsonResponse({
        rows: [{ elements: [{ status: "OK", distance: { value: 65200 } }] }],
      });
    }
    return jsonResponse({ code: "Ok", routes: [{ distance: 67742 }] });
  }) as typeof fetch;

  const km = await resolveMotoboyDistanceKm(SE_COORDINATES, ATIBAIA);
  assert.equal(km, 65.2);
  assert.equal(urls.length, 1);
  assert.match(urls[0]!, /maps\.googleapis\.com/);
});

test("resolveMotoboyDistanceKm usa OSRM se o Google falhar", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = "test-key";
  clearMotoboyRouteCacheForTests();
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey == null) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = originalKey;
    clearMotoboyRouteCacheForTests();
  });

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("maps.googleapis.com")) {
      return jsonResponse({ rows: [{ elements: [{ status: "ZERO_RESULTS" }] }] });
    }
    return jsonResponse({ code: "Ok", routes: [{ distance: 67742 }] });
  }) as typeof fetch;

  const km = await resolveMotoboyDistanceKm(SE_COORDINATES, ATIBAIA);
  assert.equal(km, 67.742);
});

test("resolveMotoboyDistanceKm cai no Haversine se a rota falhar", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GOOGLE_MAPS_API_KEY;
  delete process.env.GOOGLE_MAPS_API_KEY;
  clearMotoboyRouteCacheForTests();
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey == null) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = originalKey;
    clearMotoboyRouteCacheForTests();
  });

  globalThis.fetch = (async () => jsonResponse({ code: "NoRoute" })) as typeof fetch;

  const km = await resolveMotoboyDistanceKm(SE_COORDINATES, ATIBAIA);
  const expected = haversineKm(SE_COORDINATES.lat, SE_COORDINATES.lng, ATIBAIA.lat, ATIBAIA.lng);
  assert.equal(km, expected);
});
