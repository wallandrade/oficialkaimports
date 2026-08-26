import assert from "node:assert/strict";
import test from "node:test";

import { pickMotoboyCepRange } from "./motoboy-cep-range-pick";

const faixa044 = {
  label: "Faixa Correios 044",
  city: "Pedreira",
  cepStart: 4_400_000,
  cepEnd: 4_499_999,
  sortOrder: 10,
};

test("CEP 04476-600 usa a faixa 044 mesmo com cidade Sao Paulo vs Pedreira", () => {
  const wideSp = {
    label: "SP toda",
    city: "São Paulo",
    cepStart: 1_000_000,
    cepEnd: 9_999_999,
    sortOrder: 1,
  };
  const picked = pickMotoboyCepRange([wideSp, faixa044], "São Paulo");
  assert.equal(picked?.label, "Faixa Correios 044");
});

test("faixa sem cidade ainda libera Motoboy", () => {
  const picked = pickMotoboyCepRange([{ ...faixa044, city: null }], "São Paulo");
  assert.equal(picked?.label, "Faixa Correios 044");
});

test("cidade igual so desempata faixas do mesmo tamanho", () => {
  const other = { ...faixa044, label: "044 leste", city: "São Paulo", sortOrder: 2 };
  const picked = pickMotoboyCepRange([faixa044, other], "São Paulo");
  assert.equal(picked?.label, "044 leste");
});

test("sem candidatos devolve null", () => {
  assert.equal(pickMotoboyCepRange([], "São Paulo"), null);
});
