import assert from "node:assert/strict";
import test from "node:test";

import { parseBrasilApiCoordinates } from "./motoboy-geocode";

test("parseBrasilApiCoordinates lê location.coordinates", () => {
  const coords = parseBrasilApiCoordinates({
    location: { coordinates: { latitude: "-23.550385", longitude: "-46.633956" } },
  });
  assert.ok(coords);
  assert.ok(Math.abs(coords!.lat - (-23.550385)) < 1e-6);
  assert.ok(Math.abs(coords!.lng - (-46.633956)) < 1e-6);
});

test("parseBrasilApiCoordinates ignora 0,0 e vazio", () => {
  assert.equal(parseBrasilApiCoordinates({ location: { coordinates: { latitude: "0", longitude: "0" } } }), null);
  assert.equal(parseBrasilApiCoordinates({ location: { coordinates: {} } }), null);
  assert.equal(parseBrasilApiCoordinates({}), null);
});
