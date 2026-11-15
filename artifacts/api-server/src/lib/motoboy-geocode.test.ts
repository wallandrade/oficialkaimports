import assert from "node:assert/strict";
import test from "node:test";

import {
  formatMotoboyDistanceNotes,
  quoteMotoboyDistance,
  SE_COORDINATES,
} from "./motoboy-distance";
import {
  clearMotoboyGeocodeCacheForTests,
  formatMotoboyGeocodeQuery,
  isGenericCityCentroid,
  isRejectedGeocode,
  isSameAsMotoboyOrigin,
  motoboyGeocodeCacheKey,
  parseAwesomeApiCoordinates,
  parseBrasilApiCoordinates,
  parseGoogleGeocodeCoordinates,
  parseNominatimCoordinates,
  SAO_PAULO_CITY_CENTROID,
} from "./motoboy-geocode";
import { clearMotoboyRouteCacheForTests, resolveMotoboyAddressDistance } from "./motoboy-route";

const CAPAO = { lat: -23.6762, lng: -46.7742 };
const CANGAIBA = { lat: -23.4426, lng: -46.5164 };
const NEAR_SE = { lat: -23.556, lng: -46.633956 };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function hostOf(input: string | URL | Request): string {
  const url = String(input instanceof Request ? input.url : input);
  return url.split("?")[0] ?? url;
}

test("parseBrasilApiCoordinates lê location.coordinates", () => {
  const coords = parseBrasilApiCoordinates({
    location: { coordinates: { latitude: "-23.550385", longitude: "-46.633956" } },
  });
  assert.ok(coords);
  assert.ok(Math.abs(coords.lat - (-23.550385)) < 1e-6);
  assert.ok(Math.abs(coords.lng - (-46.633956)) < 1e-6);
});

test("parseBrasilApiCoordinates ignora 0,0 e vazio", () => {
  assert.equal(parseBrasilApiCoordinates({ location: { coordinates: { latitude: "0", longitude: "0" } } }), null);
  assert.equal(parseBrasilApiCoordinates({ location: { coordinates: {} } }), null);
  assert.equal(parseBrasilApiCoordinates({}), null);
});

test("centroide de São Paulo é rejeitado; ponto de rua não", () => {
  assert.equal(isGenericCityCentroid(SAO_PAULO_CITY_CENTROID), true);
  assert.equal(isRejectedGeocode(SAO_PAULO_CITY_CENTROID), true);
  assert.equal(isGenericCityCentroid(CAPAO), false);
  assert.equal(isSameAsMotoboyOrigin(SE_COORDINATES), true);
  assert.equal(isRejectedGeocode(SE_COORDINATES), true);
  assert.equal(isRejectedGeocode(CAPAO), false);
  assert.equal(isRejectedGeocode(NEAR_SE), false);
});

test("parseAwesomeApi e Nominatim e Google", () => {
  assert.deepEqual(parseAwesomeApiCoordinates({ lat: "-23.6762", lng: "-46.7742" }), CAPAO);
  assert.equal(parseAwesomeApiCoordinates({ code: "not_found" }), null);
  assert.deepEqual(parseNominatimCoordinates([{ lat: "-23.6762", lon: "-46.7742", addresstype: "road" }]), CAPAO);
  assert.equal(parseNominatimCoordinates([{ lat: "-23.5475", lon: "-46.63611", addresstype: "city" }]), null);
  assert.deepEqual(parseGoogleGeocodeCoordinates({
    status: "OK",
    results: [{ geometry: { location: CAPAO, location_type: "ROOFTOP" } }],
  }), CAPAO);
  assert.equal(parseGoogleGeocodeCoordinates({
    status: "OK",
    results: [{ geometry: { location: SAO_PAULO_CITY_CENTROID, location_type: "APPROXIMATE" } }],
  }), null);
});

test("query junta rua, número, bairro, cidade e UF", () => {
  assert.equal(formatMotoboyGeocodeQuery({
    cep: "05893120",
    street: "Rua Liberal Bruant",
    number: "182",
    neighborhood: "Capão Redondo",
    city: "São Paulo",
    state: "SP",
  }), "Rua Liberal Bruant, 182, Capão Redondo, São Paulo, SP, 05893-120, Brasil");
  assert.equal(motoboyGeocodeCacheKey("05893-120", "182"), "05893120|182");
  assert.equal(motoboyGeocodeCacheKey("05893-120", ""), "05893120|");
});

test("cotação por endereço com APIs mockadas", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GOOGLE_MAPS_API_KEY;

  const restore = () => {
    globalThis.fetch = originalFetch;
    if (originalKey == null) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = originalKey;
    clearMotoboyGeocodeCacheForTests();
    clearMotoboyRouteCacheForTests();
  };

  function install(handler: (url: string, init?: RequestInit) => Response, opts?: { keepKey?: boolean }) {
    clearMotoboyGeocodeCacheForTests();
    clearMotoboyRouteCacheForTests();
    if (!opts?.keepKey) delete process.env.GOOGLE_MAPS_API_KEY;
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push(hostOf(url));
      return handler(url, init);
    }) as typeof fetch;
    return calls;
  }

  function viaCep(url: string): Response | null {
    if (!url.includes("viacep.com.br")) return null;
    if (url.includes("05893120")) {
      return jsonResponse({
        logradouro: "Rua Liberal Bruant",
        bairro: "Capão Redondo",
        localidade: "São Paulo",
        uf: "SP",
      });
    }
    if (url.includes("03819190")) {
      return jsonResponse({
        logradouro: "Rua da Boquena",
        bairro: "Parque Císper",
        localidade: "São Paulo",
        uf: "SP",
      });
    }
    return jsonResponse({
      logradouro: "Praça da Sé",
      bairro: "Sé",
      localidade: "São Paulo",
      uf: "SP",
    });
  }

  function awesome(url: string, capao = CAPAO, cangaiba = CANGAIBA): Response | null {
    if (!url.includes("cep.awesomeapi.com.br")) return null;
    if (url.includes("05893120")) return jsonResponse({ lat: String(capao.lat), lng: String(capao.lng) });
    if (url.includes("03819190")) return jsonResponse({ lat: String(cangaiba.lat), lng: String(cangaiba.lng) });
    return jsonResponse({ lat: String(SAO_PAULO_CITY_CENTROID.lat), lng: String(SAO_PAULO_CITY_CENTROID.lng) });
  }

  function osrm(url: string): Response | null {
    if (!url.includes("router.project-osrm.org")) return null;
    if (url.includes("-23.6762")) return jsonResponse({ code: "Ok", routes: [{ distance: 23900 }] });
    if (url.includes("-23.4426")) return jsonResponse({ code: "Ok", routes: [{ distance: 19700 }] });
    if (url.includes("-23.556")) return jsonResponse({ code: "Ok", routes: [{ distance: 600 }] });
    return jsonResponse({ code: "Ok", routes: [{ distance: 400 }] });
  }

  t.after(restore);

  await t.test("05893-120 com número 182 cai em 16–30 km = R$ 100", async () => {
    const calls = install((url) => {
      return viaCep(url) ?? awesome(url) ?? osrm(url) ?? jsonResponse({ status: 404 }, 404);
    });
    const distance = await resolveMotoboyAddressDistance({
      cep: "05893-120",
      number: "182",
      neighborhood: "Capão Redondo",
      city: "São Paulo",
      state: "SP",
    });
    assert.equal(distance.geoSource, "awesomeapi");
    assert.equal(distance.km, 23.9);
    const quote = quoteMotoboyDistance({
      cep: "05893120",
      bairro: "Capão Redondo",
      cidade: "São Paulo",
      km: distance.km,
    });
    assert.equal(quote.outcome, "priced");
    if (quote.outcome === "priced") {
      assert.equal(quote.price, 100);
      assert.equal(quote.label, "16–30 km");
      assert.equal(quote.billedKm, 24);
    }
    assert.equal(
      formatMotoboyDistanceNotes(quote.outcome === "priced" ? quote.label : "", distance.km, distance.geoSource),
      "Motoboy — 16–30 km (23.9 km, AwesomeAPI)",
    );
    assert.equal(calls.some((url) => url.includes("nominatim")), false);
    assert.equal(calls.some((url) => url.includes("brasilapi")), false);
    assert.equal(calls.filter((url) => url.includes("awesomeapi")).length, 1);

    const again = await resolveMotoboyAddressDistance({ cep: "05893-120", number: "182" });
    assert.equal(again.km, 23.9);
    assert.equal(calls.filter((url) => url.includes("awesomeapi")).length, 1);

    await resolveMotoboyAddressDistance({ cep: "05893-120", number: "200" });
    assert.equal(calls.filter((url) => url.includes("awesomeapi")).length, 2);
  });

  await t.test("03819-190 Rua da Boquena 13 cai em 16–30 km = R$ 100", async () => {
    install((url) => viaCep(url) ?? awesome(url) ?? osrm(url) ?? jsonResponse({}, 404));
    const distance = await resolveMotoboyAddressDistance({
      cep: "03819-190",
      street: "Rua da Boquena",
      number: "13",
      neighborhood: "Parque Císper",
      city: "São Paulo",
      state: "SP",
    });
    assert.equal(distance.geoSource, "awesomeapi");
    assert.equal(distance.km, 19.7);
    const quote = quoteMotoboyDistance({
      cep: "03819190",
      bairro: "Parque Císper",
      cidade: "São Paulo",
      km: distance.km,
    });
    assert.equal(quote.outcome, "priced");
    if (quote.outcome === "priced") {
      assert.equal(quote.price, 100);
      assert.equal(quote.label, "16–30 km");
      assert.equal(quote.billedKm, 20);
    }
  });

  await t.test("CEP do centro continua R$ 50 mesmo com centroide rejeitado", async () => {
    install((url) => {
      const via = viaCep(url);
      if (via) return via;
      if (url.includes("awesomeapi") || url.includes("brasilapi")) {
        return jsonResponse({
          lat: String(SAO_PAULO_CITY_CENTROID.lat),
          lng: String(SAO_PAULO_CITY_CENTROID.lng),
          location: {
            coordinates: {
              latitude: String(SAO_PAULO_CITY_CENTROID.lat),
              longitude: String(SAO_PAULO_CITY_CENTROID.lng),
            },
          },
        });
      }
      if (url.includes("nominatim")) {
        return jsonResponse([{
          lat: String(SAO_PAULO_CITY_CENTROID.lat),
          lon: String(SAO_PAULO_CITY_CENTROID.lng),
          addresstype: "road",
        }]);
      }
      return osrm(url) ?? jsonResponse({}, 404);
    });
    const distance = await resolveMotoboyAddressDistance({
      cep: "01001-000",
      neighborhood: "Sé",
      city: "São Paulo",
      state: "SP",
    });
    assert.equal(distance.km, null);
    assert.equal(distance.geoSource, null);
    const quote = quoteMotoboyDistance({
      cep: "01001000",
      bairro: "Sé",
      cidade: "São Paulo",
      km: distance.km,
    });
    assert.equal(quote.outcome, "centro");
    if (quote.outcome === "centro") assert.equal(quote.price, 50);
  });

  await t.test("coordenada genérica não cobra Até 10 km", async () => {
    const calls = install((url, init) => {
      if (url.includes("nominatim")) {
        const headers = new Headers(init?.headers);
        assert.match(headers.get("user-agent") ?? "", /oficialkaimports-motoboy/);
        return jsonResponse([{
          lat: String(SAO_PAULO_CITY_CENTROID.lat),
          lon: String(SAO_PAULO_CITY_CENTROID.lng),
          addresstype: "road",
        }]);
      }
      if (url.includes("awesomeapi") || url.includes("brasilapi")) {
        return jsonResponse({
          lat: String(SAO_PAULO_CITY_CENTROID.lat),
          lng: String(SAO_PAULO_CITY_CENTROID.lng),
          location: {
            coordinates: {
              latitude: String(SAO_PAULO_CITY_CENTROID.lat),
              longitude: String(SAO_PAULO_CITY_CENTROID.lng),
            },
          },
        });
      }
      return viaCep(url) ?? jsonResponse({}, 404);
    });
    const distance = await resolveMotoboyAddressDistance({
      cep: "05893-120",
      number: "182",
      neighborhood: "Capão Redondo",
      city: "São Paulo",
    });
    assert.equal(distance.km, null);
    assert.equal(distance.geoSource, null);
    const quote = quoteMotoboyDistance({
      cep: "05893120",
      bairro: "Capão Redondo",
      cidade: "São Paulo",
      km: distance.km,
    });
    assert.equal(quote.outcome, "unavailable");
    assert.equal(calls.some((url) => url.includes("nominatim")), true);
    assert.equal(calls.some((url) => url.includes("brasilapi")), true);
  });

  await t.test("menos de 1 km fora do centro não cobra Até 10 km", async () => {
    install((url) => {
      if (url.includes("awesomeapi")) return jsonResponse({ lat: String(NEAR_SE.lat), lng: String(NEAR_SE.lng) });
      return viaCep(url) ?? osrm(url) ?? jsonResponse({}, 404);
    });
    const distance = await resolveMotoboyAddressDistance({
      cep: "01310100",
      street: "Avenida Paulista",
      number: "100",
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "SP",
    });
    assert.equal(distance.km, null);
    const quote = quoteMotoboyDistance({
      cep: "01310100",
      bairro: "Bela Vista",
      cidade: "São Paulo",
      km: distance.km,
    });
    assert.equal(quote.outcome, "unavailable");
  });

  await t.test("Google vem antes da AwesomeAPI quando a chave existe", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    const calls = install((url) => {
      if (url.includes("maps.googleapis.com/maps/api/geocode")) {
        assert.match(url, /Liberal/);
        assert.match(url, /182/);
        return jsonResponse({
          status: "OK",
          results: [{ geometry: { location: CAPAO, location_type: "ROOFTOP" } }],
        });
      }
      if (url.includes("maps.googleapis.com/maps/api/distancematrix")) {
        return jsonResponse({ rows: [{ elements: [{ status: "OK", distance: { value: 23900 } }] }] });
      }
      return viaCep(url) ?? awesome(url) ?? jsonResponse({}, 404);
    }, { keepKey: true });
    const distance = await resolveMotoboyAddressDistance({
      cep: "05893120",
      street: "Rua Liberal Bruant",
      number: "182",
      neighborhood: "Capão Redondo",
      city: "São Paulo",
      state: "SP",
    });
    assert.equal(distance.geoSource, "google");
    assert.equal(distance.km, 23.9);
    assert.equal(calls.some((url) => url.includes("awesomeapi")), false);
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  await t.test("ponto igual à Sé é pulado e o próximo provedor vale", async () => {
    const calls = install((url, init) => {
      if (url.includes("awesomeapi")) {
        return jsonResponse({ lat: String(SE_COORDINATES.lat), lng: String(SE_COORDINATES.lng) });
      }
      if (url.includes("nominatim")) {
        const headers = new Headers(init?.headers);
        assert.match(headers.get("user-agent") ?? "", /oficialkaimports-motoboy/);
        assert.match(url, /Liberal/);
        return jsonResponse([{ lat: String(CAPAO.lat), lon: String(CAPAO.lng), addresstype: "house" }]);
      }
      return viaCep(url) ?? osrm(url) ?? jsonResponse({}, 404);
    });
    const distance = await resolveMotoboyAddressDistance({ cep: "05893120", number: "182" });
    assert.equal(distance.geoSource, "nominatim");
    assert.equal(distance.km, 23.9);
    assert.equal(calls.some((url) => url.includes("viacep")), true);
    const quote = quoteMotoboyDistance({
      cep: "05893120",
      bairro: "Capão Redondo",
      cidade: "São Paulo",
      km: distance.km,
    });
    assert.equal(quote.outcome, "priced");
    if (quote.outcome === "priced") assert.equal(quote.price, 100);
  });
});
