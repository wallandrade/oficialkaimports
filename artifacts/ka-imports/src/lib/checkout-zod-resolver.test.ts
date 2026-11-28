import assert from "node:assert/strict";
import test from "node:test";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

test("zod 4 devolve o erro do campo no checkout", async () => {
  const resolver = zodResolver(z.object({
    email: z.string().email("E-mail inválido"),
  }));
  const result = await resolver({ email: "nao-e-email" }, undefined, {
    fields: {},
    shouldUseNativeValidation: false,
    criteriaMode: "firstError",
  });
  assert.equal(result.errors.email?.message, "E-mail inválido");
});
