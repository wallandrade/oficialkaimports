import assert from "node:assert/strict";
import test from "node:test";
import { planMediaCopy } from "./media-backup-plan.mjs";
import { copyPlanned, formatMediaCopyFailure } from "./media-backup-r2.mjs";

test("copia o que falta e o que mudou de tamanho, e não apaga o que só está no destino", () => {
  const source = [
    { key: "products/a.jpg", size: 100 },
    { key: "products/b.jpg", size: 50 },
    { key: "tracking-labels/c.pdf", size: 80 },
    { key: "whatsapp-groups/d.jpg", size: 10 },
    { key: "site-settings/e.png", size: 0 },
    { key: "products/", size: 0 },
  ];
  const destination = [
    { key: "media/products/a.jpg", size: 100 },
    { key: "media/products/b.jpg", size: 40 },
    { key: "media/old/gone.jpg", size: 999 },
    { key: "media/site-settings/e.png", size: 0 },
  ];
  const plan = planMediaCopy(source, destination);
  assert.equal(plan.total, 5);
  assert.equal(plan.present, 2);
  assert.equal(plan.missing, 3);
  assert.deepEqual(plan.copy.map((item) => item.key), [
    "products/b.jpg",
    "tracking-labels/c.pdf",
    "whatsapp-groups/d.jpg",
  ]);
  assert.equal(plan.copy.some((item) => item.destKey === "media/old/gone.jpg"), false);
  assert.equal("delete" in plan, false);
});

test("origem vazia dá total zero", () => {
  const plan = planMediaCopy([], [{ key: "media/products/a.jpg", size: 1 }]);
  assert.equal(plan.total, 0);
  assert.equal(plan.missing, 0);
  assert.deepEqual(plan.copy, []);
});

test("uma chave que falha não impede a cópia das outras", async () => {
  const items = [
    { key: "products/a.jpg", size: 10 },
    { key: "products/bad.jpg", size: 20 },
    { key: "products/c.jpg", size: 30 },
    { key: "tracking-labels/d.pdf", size: 5 },
  ];
  const copied = [];
  const result = await copyPlanned(items, async (item) => {
    if (item.key === "products/bad.jpg") throw new Error("negado");
    copied.push(item.key);
  });
  assert.deepEqual(copied.sort(), ["products/a.jpg", "products/c.jpg", "tracking-labels/d.pdf"]);
  assert.equal(result.copied, 3);
  assert.equal(result.bytes, 45);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].key, "products/bad.jpg");
  const many = Array.from({ length: 6 }, (_, index) => ({ key: `products/${index}.jpg`, message: "x" }));
  const text = formatMediaCopyFailure(many);
  assert.match(text, /^falha ao copiar 6 chave\(s\): /);
  assert.equal(text.split(", ").length, 5);
  assert.equal(text.includes("products/5.jpg"), false);
});

test("a mesma chave repetida conta uma vez", () => {
  const plan = planMediaCopy(
    [{ key: "products/a.jpg", size: 1 }, { key: "products/a.jpg", size: 2 }],
    [],
  );
  assert.equal(plan.total, 1);
  assert.equal(plan.copy[0].size, 2);
  assert.equal(plan.copy[0].destKey, "media/products/a.jpg");
});
