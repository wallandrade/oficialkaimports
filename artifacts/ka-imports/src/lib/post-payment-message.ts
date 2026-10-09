const INSURANCE_10 = [
  "⚠️ **Produto com seguro 10%**",
  "Você está ciente de que este seguro só vale contra roubo e extravio. O ressarcimento é outro produto igual, e só depois que constar no sistema que o pedido foi extraviado ou roubado.",
].join("\n");

const INSURANCE_20 = [
  "⚠️ **Seguro 20%**",
  "Você está ciente de que este seguro é válido 100%. O ressarcimento só acontece depois que constar no sistema que o ocorrido foi registrado.",
].join("\n");

const INSURANCE_NONE = [
  "⚠️ **Compra sem seguro**",
  "Você está ciente de que comprou sem seguro. Se acontecer roubo, extravio, danificação ou apreensão, não há direito a ressarcimento, porque a compra foi feita sem seguro.",
].join("\n");

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function boughtInsurance(order: { includeInsurance?: unknown; insuranceAmount?: unknown }): boolean {
  const amount = Number(order?.insuranceAmount);
  if (Number.isFinite(amount) && amount > 0) return true;
  const flag = order?.includeInsurance;
  return flag === true || flag === 1 || flag === "1" || flag === "true";
}

/** 10% e 20% são o nome do aviso. Não leem o percentual da aba Seguro. */
export function postPaymentInsuranceNotice(order: {
  includeInsurance?: unknown;
  insuranceAmount?: unknown;
  insurancePlan?: unknown;
}): string {
  if (!boughtInsurance(order)) return INSURANCE_NONE;
  const plan = text(order?.insurancePlan).toLowerCase();
  if (plan === "reduced" || plan === "reduzido") return INSURANCE_10;
  return INSURANCE_20;
}

function displayOrderNumber(order: { orderNumber?: unknown; id?: unknown }): string {
  const numeric = Number(order?.orderNumber);
  if (Number.isFinite(numeric) && numeric > 0) return String(Math.trunc(numeric));
  const id = text(order?.id);
  return id || "-";
}

function readProducts(raw: unknown): Array<{ quantity?: unknown; name?: unknown }> {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function firstName(clientName: unknown): string {
  const word = text(clientName).split(/\s+/).filter(Boolean)[0];
  return word || "Cliente";
}

function addressLines(order: {
  addressStreet?: unknown;
  addressNumber?: unknown;
  addressNeighborhood?: unknown;
  addressComplement?: unknown;
  addressCity?: unknown;
  addressState?: unknown;
  addressCep?: unknown;
}): string[] {
  const street = [text(order.addressStreet), text(order.addressNumber)].filter(Boolean).join(", ");
  const neighborhood = text(order.addressNeighborhood);
  const complement = text(order.addressComplement);
  const city = text(order.addressCity);
  const state = text(order.addressState);
  const cityLine = city && state ? `${city}/${state}` : city || state;
  const cep = text(order.addressCep);
  return [
    street,
    neighborhood ? `Bairro: ${neighborhood}` : "",
    complement ? `Complemento: ${complement}` : "",
    cityLine,
    cep ? `CEP: ${cep}` : "",
  ].filter(Boolean);
}

export function orderToPostPaymentText(order: {
  clientName?: unknown;
  orderNumber?: unknown;
  id?: unknown;
  products?: unknown;
  addressStreet?: unknown;
  addressNumber?: unknown;
  addressNeighborhood?: unknown;
  addressComplement?: unknown;
  addressCity?: unknown;
  addressState?: unknown;
  addressCep?: unknown;
  includeInsurance?: unknown;
  insuranceAmount?: unknown;
  insurancePlan?: unknown;
  logisticsAllocation?: { promisedHours?: unknown } | null;
}): string {
  const products = readProducts(order?.products);
  const productsText = products.length
    ? products
        .map((product) => {
          const qty = Number(product?.quantity) || 0;
          return `💊 ${qty}x ${text(product?.name) || "Produto"}`;
        })
        .join("\n")
    : "💊 1x Produto";

  const allocatedHours = Number(order?.logisticsAllocation?.promisedHours);
  const trackingReleaseHours = Number.isFinite(allocatedHours) && allocatedHours > 0 ? allocatedHours : 48;

  return [
    `🎉 **Parabéns, ${firstName(order?.clientName)}! Sua compra foi confirmada com sucesso!** ✅📦`,
    `📦 **Pedido #${displayOrderNumber(order)}**`,
    "",
    "Seu pagamento já foi aprovado e o seu pedido foi registrado em nosso sistema. Agora ele segue para a etapa de preparação e envio. 🚀",
    "",
    "📋 **Resumo do pedido:**",
    productsText,
    "",
    "📍 **Entrega:**",
    ...addressLines(order),
    "",
    `⏳ Pedimos que aguarde até **${trackingReleaseHours} horas úteis** para a liberação do código de rastreio. Esse prazo é necessário para organização do envio e para conseguirmos manter um atendimento mais rápido e eficiente para todos os clientes. 🙏`,
    "",
    "Assim que o rastreio estiver disponível, você poderá acompanhar a movimentação do seu pedido. 📲",
    "",
    "⚠️ **Importante:** sábados, domingos e feriados não são considerados dias úteis para processamento de envio.",
    "",
    postPaymentInsuranceNotice(order),
    "",
    "Obrigado pela confiança! 💙📦",
  ].join("\n");
}
