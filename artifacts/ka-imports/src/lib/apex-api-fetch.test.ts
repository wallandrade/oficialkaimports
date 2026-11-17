import assert from "node:assert/strict";
import test from "node:test";
import { rewriteApexApiUrl } from "./apex-api-fetch";

test("apex manda /api direto para www", () => {
  assert.equal(
    rewriteApexApiUrl("/api/admin/orders/1/shopee-route", "ka-imports.com"),
    "https://lobster-app-7f8c2.ondigitalocean.app/api/admin/orders/1/shopee-route",
  );
  assert.equal(
    rewriteApexApiUrl("https://ka-imports.com/api/settings", "ka-imports.com"),
    "https://lobster-app-7f8c2.ondigitalocean.app/api/settings",
  );
  assert.equal(rewriteApexApiUrl("/api/admin/orders/1/shopee-route", "www.ka-imports.com"), null);
  assert.equal(rewriteApexApiUrl("/assets/index.js", "ka-imports.com"), null);
});
