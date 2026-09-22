import assert from "node:assert/strict";
import test from "node:test";
import { historyEventTimeMs } from "./envioecom-history-time";

test("le data brasileira dd/mm/aaaa hh:mm:ss", () => {
  assert.equal(Number.isNaN(Date.parse("22/09/2026 08:08:08")), true);
  assert.equal(historyEventTimeMs("22/09/2026 08:08:08") > historyEventTimeMs("22/09/2026 08:00:00"), true);
  assert.equal(historyEventTimeMs("22/09/2026 08:08:08"), Date.parse("2026-09-22T08:08:08-03:00"));
});
