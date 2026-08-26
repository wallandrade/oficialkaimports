import assert from "node:assert/strict";
import test from "node:test";

import { normalizeMotoboyPlaceName } from "./motoboy-neighborhood-normalize";

test("remove acento, parenteses e colapsa espacos", () => {
  assert.equal(
    normalizeMotoboyPlaceName("Jardim São Paulo (Zona Leste)"),
    "jardim sao paulo",
  );
  assert.equal(normalizeMotoboyPlaceName("  Centro   "), "centro");
  assert.equal(normalizeMotoboyPlaceName("Água Rasa"), "agua rasa");
});
