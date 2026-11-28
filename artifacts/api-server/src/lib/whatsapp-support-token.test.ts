import assert from "node:assert/strict";
import test from "node:test";
import { readWhatsappSupportToken, whatsappWebhookAllowsQueryToken } from "./whatsapp-support-token";

test("token do atendimento entra pelo header x-whatsapp-support-token", () => {
  assert.equal(
    readWhatsappSupportToken({
      headerToken: "header-token",
      queryToken: "query-token",
      allowQueryToken: true,
    }),
    "header-token",
  );
});

test("query do webhook só vale com WHATSAPP_WEBHOOK_ALLOW_QUERY_TOKEN", () => {
  assert.equal(whatsappWebhookAllowsQueryToken({}), true);
  assert.equal(whatsappWebhookAllowsQueryToken({ WHATSAPP_WEBHOOK_ALLOW_QUERY_TOKEN: "false" }), false);
  assert.equal(
    readWhatsappSupportToken({ headerToken: "", queryToken: "query-token", allowQueryToken: false }),
    "",
  );
  assert.equal(
    readWhatsappSupportToken({ headerToken: "", queryToken: "query-token", allowQueryToken: true }),
    "query-token",
  );
});
