import assert from "node:assert/strict";
import test from "node:test";
import {
  activeSellerSlug,
  boundSellerWhatsApp,
  buildWhatsAppUrl,
  resolveSellerWhatsAppStrict,
  sellerSlugFromPathname,
  shouldResetSellerWhatsAppCache,
  type SellerWhatsAppCache,
} from "./seller-whatsapp.ts";

const STORE_DEFAULT = "5511917082244";

function cacheOf(number = "", slug = ""): SellerWhatsAppCache {
  return { number, slug };
}

test("rotas sem vendedor não viram slug", () => {
  assert.equal(sellerSlugFromPathname("/kaique"), "kaique");
  assert.equal(sellerSlugFromPathname("/Kaique/checkout"), "kaique");
  assert.equal(sellerSlugFromPathname("/pix/abc"), "");
  assert.equal(sellerSlugFromPathname("/success"), "");
  assert.equal(sellerSlugFromPathname("/ofertas"), "");
  assert.equal(sellerSlugFromPathname("/minha-conta/pedidos"), "");
  assert.equal(sellerSlugFromPathname("/produto/1"), "");
  assert.equal(sellerSlugFromPathname("/"), "");
  assert.equal(activeSellerSlug("/pix/tx", "kaique"), "kaique");
  assert.equal(activeSellerSlug("/beatriz", "kaique"), "beatriz");
  assert.equal(activeSellerSlug("/ofertas", ""), "");
  assert.equal(activeSellerSlug("/checkout", "kaique"), "kaique");
});

test("troca de slug apaga o cache; o mesmo slug não apaga", () => {
  assert.equal(shouldResetSellerWhatsAppCache("kaique", "kaique"), false);
  assert.equal(shouldResetSellerWhatsAppCache(" Kaique ", "kaique"), false);
  assert.equal(shouldResetSellerWhatsAppCache("kaique", "beatriz"), true);
  assert.equal(shouldResetSellerWhatsAppCache("", "kaique"), true);
  assert.equal(shouldResetSellerWhatsAppCache("kaique", " "), false);
});

test("cache só vale para o mesmo slug", () => {
  assert.equal(boundSellerWhatsApp("55 (11) 98888-7777", "KAIQUE", "kaique"), "5511988887777");
  assert.equal(boundSellerWhatsApp("5511988887777", "beatriz", "kaique"), "");
  assert.equal(boundSellerWhatsApp("", "kaique", "kaique"), "");
});

test("sem vendedor usa o número da loja e não busca a API", async () => {
  let fetches = 0;
  const number = await resolveSellerWhatsAppStrict({
    sellerCode: "",
    readCache: () => cacheOf("5511999990000", "kaique"),
    writeCache: () => {
      throw new Error("não grava cache sem vendedor");
    },
    fetchSellerWhatsApp: async () => {
      fetches += 1;
      return "5511000000000";
    },
    getActiveSellerCode: () => "",
    storeDefault: () => "55 11 91708-2244",
  });
  assert.equal(number, STORE_DEFAULT);
  assert.equal(fetches, 0);
});

test("cache do mesmo slug abre na hora e não chama a API", async () => {
  let fetches = 0;
  const number = await resolveSellerWhatsAppStrict({
    sellerCode: " Kaique ",
    readCache: () => cacheOf("+55 (11) 98888-7777", "KAIQUE"),
    writeCache: () => {
      throw new Error("cache já confirmado");
    },
    fetchSellerWhatsApp: async () => {
      fetches += 1;
      return "5511000000000";
    },
    getActiveSellerCode: () => "kaique",
    storeDefault: () => {
      throw new Error("padrão não entra com vendedor");
    },
  });
  assert.equal(number, "5511988887777");
  assert.equal(fetches, 0);
});

test("cache de outro vendedor não serve; a API grava o slug certo", async () => {
  let stored = cacheOf("551188887777", "beatriz");
  const number = await resolveSellerWhatsAppStrict({
    sellerCode: "kaique",
    readCache: () => stored,
    writeCache: (slug, value) => {
      stored = cacheOf(value, slug);
    },
    fetchSellerWhatsApp: async (slug) => {
      assert.equal(slug, "kaique");
      return "(55) 11 99999-0000";
    },
    getActiveSellerCode: () => "kaique",
    storeDefault: () => {
      throw new Error("padrão não entra com vendedor");
    },
  });
  assert.equal(number, "5511999990000");
  assert.deepEqual(stored, cacheOf("5511999990000", "kaique"));
});

test("API falha: não abre outro vendedor nem o número padrão", async () => {
  const number = await resolveSellerWhatsAppStrict({
    sellerCode: "kaique",
    readCache: () => cacheOf("551188887777", "beatriz"),
    writeCache: () => {
      throw new Error("não grava número de outro vendedor");
    },
    fetchSellerWhatsApp: async () => null,
    getActiveSellerCode: () => "kaique",
    storeDefault: () => STORE_DEFAULT,
  });
  assert.equal(number, null);
});

test("API lança erro ou devolve texto sem dígito: falha fechada", async () => {
  const thrown = await resolveSellerWhatsAppStrict({
    sellerCode: "kaique",
    readCache: () => cacheOf(),
    writeCache: () => {
      throw new Error("não grava");
    },
    fetchSellerWhatsApp: async () => {
      throw new Error("offline");
    },
    getActiveSellerCode: () => "kaique",
    storeDefault: () => STORE_DEFAULT,
  });
  const blank = await resolveSellerWhatsAppStrict({
    sellerCode: "kaique",
    readCache: () => cacheOf(),
    writeCache: () => {
      throw new Error("não grava");
    },
    fetchSellerWhatsApp: async () => "sem numero",
    getActiveSellerCode: () => "kaique",
    storeDefault: () => STORE_DEFAULT,
  });
  assert.equal(thrown, null);
  assert.equal(blank, null);
});

test("resposta atrasada de outro slug é ignorada", async () => {
  let active = "kaique";
  const number = await resolveSellerWhatsAppStrict({
    sellerCode: "kaique",
    readCache: () => cacheOf("551188887777", "beatriz"),
    writeCache: () => {
      throw new Error("não grava resposta atrasada");
    },
    fetchSellerWhatsApp: async () => {
      active = "beatriz";
      return "5511999990000";
    },
    getActiveSellerCode: () => active,
    storeDefault: () => STORE_DEFAULT,
  });
  assert.equal(number, null);
});

test("se o prefetch preenche o cache durante a busca, esse número vale", async () => {
  let stored = cacheOf();
  const number = await resolveSellerWhatsAppStrict({
    sellerCode: "kaique",
    readCache: () => stored,
    writeCache: (slug, value) => {
      stored = cacheOf(value, slug);
    },
    fetchSellerWhatsApp: async () => {
      stored = cacheOf("5511999990000", "kaique");
      return null;
    },
    getActiveSellerCode: () => "kaique",
    storeDefault: () => STORE_DEFAULT,
  });
  assert.equal(number, "5511999990000");
  assert.equal(buildWhatsAppUrl(number || "", "Olá"), "https://wa.me/5511999990000?text=Ol%C3%A1");
});
