import assert from "node:assert/strict";
import test from "node:test";

import {
  applyVariantToOrderItem,
  buildCartLineId,
  buildVariantLabel,
  orderSelectedVariants,
  parseVariantGroupDrafts,
  parseVariantGroups,
  prepareVariantGroupsForSave,
  resolveVariantLineImage,
  VARIANT_GROUP_INCOMPLETE_MESSAGE,
  variantSelectionMessage,
} from "./product-variants";

const kit = {
  name: "Escolha seu kit",
  maxSelect: 4,
  imageMode: "swap",
  options: [
    { label: "TG", image: null },
    { label: "Tirzec", image: "https://cdn.exemplo/tirzec.jpg" },
    { label: "Lipoless", image: "https://cdn.exemplo/lipoless.jpg" },
    { label: "Extra", image: null },
  ],
};

test("objeto solto não entra no catálogo", () => {
  assert.deepEqual(parseVariantGroups({ name: "Cor", options: ["Preta"] }), []);
});

test("opção só texto fica sem foto e swapImage false vira fixed", () => {
  const groups = parseVariantGroups([
    { name: "Cor", swapImage: false, options: ["Preta", { label: "Azul", image: "data:image/jpeg;base64,abc" }] },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.imageMode, "fixed");
  assert.equal(groups[0]?.maxSelect, 1);
  assert.deepEqual(groups[0]?.options, [
    { label: "Preta", image: null },
    { label: "Azul", image: null },
  ]);
});

test("máximo do formulário não encolhe e o catálogo corta na publicação", () => {
  const raw = [{
    name: "Escolha seu kit",
    maxSelect: 4,
    options: [
      { label: "TG", image: "https://cdn.exemplo/tg.jpg" },
      { label: "Tirzec", image: null },
      { label: "", image: null },
    ],
  }];
  assert.equal(parseVariantGroupDrafts(raw)[0]?.maxSelect, 4);
  const saved = prepareVariantGroupsForSave(raw);
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.groups[0]?.maxSelect, 2);
  assert.equal(saved.groups[0]?.options.length, 2);
});

test("nome repetido fica só o primeiro e grupo vazio some", () => {
  const groups = parseVariantGroups([
    { name: "", options: [{ label: "", image: null }] },
    {
      name: "Cor",
      options: [
        { label: "Preta", image: "https://cdn.exemplo/1.jpg" },
        { label: "Preta", image: "https://cdn.exemplo/2.jpg" },
      ],
    },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.options.length, 1);
  assert.equal(groups[0]?.options[0]?.image, "https://cdn.exemplo/1.jpg");
});

test("grupo pela metade bloqueia o save", () => {
  const saved = prepareVariantGroupsForSave([{ name: "Cor", maxSelect: 4, options: [{ label: "" }] }]);
  assert.deepEqual(saved, { ok: false, message: VARIANT_GROUP_INCOMPLETE_MESSAGE });
});

test("ordem dos grupos segue o JSON e a ordem dos cliques fica dentro do grupo", () => {
  const groups = parseVariantGroups([
    kit,
    { name: "Cor", maxSelect: 1, imageMode: "fixed", options: [{ label: "Preta", image: "https://cdn.exemplo/preta.jpg" }] },
  ]);
  const selected = orderSelectedVariants(groups, [
    { groupName: "Cor", option: "Preta" },
    { groupName: "Escolha seu kit", option: "Tirzec" },
    { groupName: "Escolha seu kit", option: "TG" },
    { groupName: "Escolha seu kit", option: "Fantasma" },
  ]);
  assert.deepEqual(selected, [
    { groupName: "Escolha seu kit", option: "Tirzec" },
    { groupName: "Escolha seu kit", option: "TG" },
    { groupName: "Cor", option: "Preta" },
  ]);
  assert.equal(buildVariantLabel(selected), "Escolha seu kit: Tirzec, TG / Cor: Preta");
  assert.equal(
    buildCartLineId("prod", selected),
    "prod::Escolha%20seu%20kit=Tirzec&Escolha%20seu%20kit=TG&Cor=Preta",
  );
  const reversed = orderSelectedVariants(groups, [
    { groupName: "Escolha seu kit", option: "TG" },
    { groupName: "Escolha seu kit", option: "Tirzec" },
  ]);
  assert.notEqual(buildCartLineId("prod", selected), buildCartLineId("prod", reversed));
});

test("foto da linha usa a primeira opção swap com imagem do cadastro", () => {
  const groups = parseVariantGroups([
    {
      name: "Escolha seu kit",
      maxSelect: 2,
      imageMode: "swap",
      options: [
        { label: "TG", image: null },
        { label: "Tirzec", image: "https://cdn.exemplo/tirzec.jpg" },
      ],
    },
    {
      name: "Cor",
      imageMode: "fixed",
      options: [{ label: "Preta", image: "https://cdn.exemplo/preta.jpg" }],
    },
  ]);
  const selected = orderSelectedVariants(groups, [
    { groupName: "Cor", option: "Preta" },
    { groupName: "Escolha seu kit", option: "TG" },
    { groupName: "Escolha seu kit", option: "Tirzec" },
  ]);
  assert.equal(
    resolveVariantLineImage(groups, selected, "https://cdn.exemplo/produto.jpg"),
    "https://cdn.exemplo/tirzec.jpg",
  );
});

test("pedido recusa o primeiro grupo errado e não repete o rótulo", () => {
  const groups = parseVariantGroups([
    { ...kit, maxSelect: 2 },
    { name: "Cor", maxSelect: 1, options: ["Preta"] },
  ]);
  const rejected = applyVariantToOrderItem({
    groups,
    isBump: false,
    selectedRaw: [{ groupName: "Escolha seu kit", option: "TG" }],
    rawName: "Kit",
    productImage: "https://cdn.exemplo/produto.jpg",
  });
  assert.deepEqual(rejected, { ok: false, message: "Selecione 2 opções em Escolha seu kit." });
  assert.equal(variantSelectionMessage(groups, []), "Selecione 2 opções em Escolha seu kit.");

  const accepted = applyVariantToOrderItem({
    groups,
    isBump: false,
    selectedRaw: [
      { groupName: "Cor", option: "Preta" },
      { groupName: "Escolha seu kit", option: "TG" },
      { groupName: "Escolha seu kit", option: "Tirzec" },
    ],
    variantLabel: "Escolha seu kit: TG, Tirzec / Cor: Preta",
    rawName: "Kit - Escolha seu kit: TG, Tirzec / Cor: Preta",
    productImage: "https://cdn.exemplo/produto.jpg",
  });
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  assert.equal(accepted.name, "Kit - Escolha seu kit: TG, Tirzec / Cor: Preta");
  assert.equal(accepted.variantLabel, "Escolha seu kit: TG, Tirzec / Cor: Preta");
});
