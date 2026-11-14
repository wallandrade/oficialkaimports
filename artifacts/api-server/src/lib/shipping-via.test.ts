import assert from "node:assert/strict";
import test from "node:test";

import { parseShippingVia, storedShippingVia } from "./shipping-via";

test("canal de envio aceita Shopee ou volta para o normal", () => {
  assert.equal(parseShippingVia("shopee"), "shopee");
  assert.equal(parseShippingVia("Shopee"), "shopee");
  assert.equal(parseShippingVia("  SHOPEE  "), "shopee");
  assert.equal(parseShippingVia(null), null);
  assert.equal(parseShippingVia(""), null);
  assert.equal(parseShippingVia("   "), null);
  assert.equal(parseShippingVia("normal"), null);
  assert.equal(parseShippingVia("NORMAL"), null);
  assert.equal(parseShippingVia("padrao"), null);
  assert.equal(parseShippingVia("Padrão"), null);
  assert.equal(parseShippingVia("correios"), undefined);
  assert.equal(parseShippingVia("postal"), undefined);
  assert.equal(parseShippingVia(12), undefined);
  assert.equal(parseShippingVia(false), undefined);
  assert.equal(storedShippingVia("SHOPEE"), "shopee");
  assert.equal(storedShippingVia("correios"), null);
  assert.equal(storedShippingVia(null), null);
});
