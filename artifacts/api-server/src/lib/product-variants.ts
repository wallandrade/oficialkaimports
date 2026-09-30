export type VariantImageMode = "swap" | "fixed" | "all";

export type VariantOption = {
  label: string;
  image: string | null;
};

export type VariantGroup = {
  name: string;
  maxSelect: number;
  imageMode: VariantImageMode;
  options: VariantOption[];
};

export type VariantOptionDraft = {
  label: string;
  image: string | null;
};

export type VariantGroupDraft = {
  name: string;
  maxSelect: number;
  imageMode: VariantImageMode;
  options: VariantOptionDraft[];
};

export type SelectedVariant = {
  groupName: string;
  option: string;
};

export const VARIANT_GROUP_INCOMPLETE_MESSAGE = "Preencha o nome da variante e o nome de cada opção.";

export function emptyVariantGroupDraft(): VariantGroupDraft {
  return {
    name: "",
    maxSelect: 1,
    imageMode: "swap",
    options: [{ label: "", image: null }],
  };
}

function readArray(raw: unknown): unknown[] | null {
  let value = raw;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return [];
    try {
      value = JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  return value;
}

export function readHttpUrl(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return text;
  } catch {
    return null;
  }
}

function readImageMode(item: Record<string, unknown>): VariantImageMode {
  const rawMode = item.imageMode;
  const mode = rawMode == null ? "" : String(rawMode).trim().toLowerCase();
  if (mode === "swap" || mode === "fixed" || mode === "all") return mode;
  if ((rawMode == null || mode === "") && item.swapImage === false) return "fixed";
  return "swap";
}

function readDraftMax(value: unknown): number {
  const maxSelect = Number(value);
  if (!Number.isInteger(maxSelect) || maxSelect < 1 || maxSelect > 99) return 1;
  return maxSelect;
}

function readDraftOption(raw: unknown): VariantOptionDraft | null {
  if (typeof raw === "string") {
    return { label: raw.trim(), image: null };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  return {
    label: String(item.label ?? "").trim(),
    image: readHttpUrl(item.image),
  };
}

function readDraftGroup(raw: unknown): VariantGroupDraft | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const optionsRaw = Array.isArray(item.options) ? item.options : [];
  const options = optionsRaw
    .map(readDraftOption)
    .filter((option): option is VariantOptionDraft => Boolean(option));
  return {
    name: String(item.name ?? "").trim(),
    maxSelect: readDraftMax(item.maxSelect),
    imageMode: readImageMode(item),
    options,
  };
}

function namedDraftOptions(group: VariantGroupDraft): VariantOptionDraft[] {
  const seen = new Set<string>();
  const options: VariantOptionDraft[] = [];
  for (const option of group.options) {
    const label = option.label.trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    options.push({ label, image: readHttpUrl(option.image) });
  }
  return options;
}

function draftHasPhoto(group: VariantGroupDraft): boolean {
  return group.options.some((option) => Boolean(readHttpUrl(option.image)));
}

function isTotallyEmptyDraft(group: VariantGroupDraft): boolean {
  return group.name.trim() === "" && namedDraftOptions(group).length === 0 && !draftHasPhoto(group);
}

function isIncompleteDraft(group: VariantGroupDraft): boolean {
  if (isTotallyEmptyDraft(group)) return false;
  const hasName = group.name.trim() !== "";
  const hasNamedOption = namedDraftOptions(group).length > 0;
  return !hasName || !hasNamedOption;
}

function catalogGroupFromDraft(group: VariantGroupDraft): VariantGroup | null {
  const name = group.name.trim();
  const options = namedDraftOptions(group);
  if (!name || options.length === 0) return null;
  return {
    name,
    maxSelect: Math.min(readDraftMax(group.maxSelect), options.length),
    imageMode: group.imageMode,
    options,
  };
}

export function parseVariantGroupDrafts(raw: unknown): VariantGroupDraft[] {
  const list = readArray(raw);
  if (!list) return [];
  return list
    .map(readDraftGroup)
    .filter((group): group is VariantGroupDraft => Boolean(group));
}

export function parseVariantGroups(raw: unknown): VariantGroup[] {
  const list = readArray(raw);
  if (!list) return [];
  const groups: VariantGroup[] = [];
  for (const entry of list) {
    const draft = readDraftGroup(entry);
    if (!draft || isTotallyEmptyDraft(draft) || isIncompleteDraft(draft)) continue;
    const catalog = catalogGroupFromDraft(draft);
    if (catalog) groups.push(catalog);
  }
  return groups;
}

export function prepareVariantGroupsForSave(
  raw: unknown,
): { ok: true; groups: VariantGroup[] } | { ok: false; message: string } {
  if (raw == null || raw === "") return { ok: true, groups: [] };
  const list = readArray(raw);
  if (!list) return { ok: true, groups: [] };
  const groups: VariantGroup[] = [];
  for (const entry of list) {
    const draft = readDraftGroup(entry);
    if (!draft || isTotallyEmptyDraft(draft)) continue;
    if (isIncompleteDraft(draft)) {
      return { ok: false, message: VARIANT_GROUP_INCOMPLETE_MESSAGE };
    }
    const catalog = catalogGroupFromDraft(draft);
    if (!catalog) {
      return { ok: false, message: VARIANT_GROUP_INCOMPLETE_MESSAGE };
    }
    groups.push(catalog);
  }
  return { ok: true, groups };
}

export function readSelectedVariants(raw: unknown): SelectedVariant[] {
  if (!Array.isArray(raw)) return [];
  const selected: SelectedVariant[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const groupName = String(item.groupName ?? "").trim();
    const option = String(item.option ?? "").trim();
    if (!groupName || !option) continue;
    selected.push({ groupName, option });
  }
  return selected;
}

export function orderSelectedVariants(groups: VariantGroup[], raw: unknown): SelectedVariant[] {
  const incoming = readSelectedVariants(raw);
  const ordered: SelectedVariant[] = [];
  for (const group of groups) {
    const seen = new Set<string>();
    for (const item of incoming) {
      if (item.groupName !== group.name || seen.has(item.option)) continue;
      if (!group.options.some((option) => option.label === item.option)) continue;
      seen.add(item.option);
      ordered.push({ groupName: group.name, option: item.option });
    }
  }
  return ordered;
}

export function variantSelectionMessage(groups: VariantGroup[], selected: SelectedVariant[]): string | null {
  for (const group of groups) {
    const count = selected.filter((item) => item.groupName === group.name).length;
    if (count === group.maxSelect) continue;
    if (group.maxSelect === 1) return `Selecione uma opção em ${group.name}.`;
    return `Selecione ${group.maxSelect} opções em ${group.name}.`;
  }
  return null;
}

export function buildVariantLabel(selected: SelectedVariant[]): string {
  const chunks: Array<{ name: string; options: string[] }> = [];
  for (const item of selected) {
    const last = chunks[chunks.length - 1];
    if (last && last.name === item.groupName) last.options.push(item.option);
    else chunks.push({ name: item.groupName, options: [item.option] });
  }
  return chunks.map((chunk) => `${chunk.name}: ${chunk.options.join(", ")}`).join(" / ");
}

export function buildCartLineId(productId: string, selected: SelectedVariant[]): string {
  if (selected.length === 0) return productId;
  const query = selected
    .map((item) => `${encodeURIComponent(item.groupName)}=${encodeURIComponent(item.option)}`)
    .join("&");
  return `${productId}::${query}`;
}

export function catalogIdFromLineId(lineId: string): string {
  const marker = lineId.indexOf("::");
  return marker === -1 ? lineId : lineId.slice(0, marker);
}

export function cartCatalogProductId(item: {
  id?: string;
  productId?: string;
  isBump?: boolean;
  bumpProductId?: string;
}): string {
  if (item.isBump) return String(item.bumpProductId || item.productId || "").trim();
  const explicit = String(item.productId || "").trim();
  if (explicit) return explicit;
  return catalogIdFromLineId(String(item.id || "").trim());
}

export function resolveVariantLineImage(
  groups: VariantGroup[],
  selected: SelectedVariant[],
  productImage: string | null | undefined,
): string | null {
  for (const item of selected) {
    const group = groups.find((entry) => entry.name === item.groupName);
    if (!group || group.imageMode !== "swap") continue;
    const option = group.options.find((entry) => entry.label === item.option);
    if (option?.image) return option.image;
  }
  const fallback = String(productImage ?? "").trim();
  return fallback || null;
}

export function allModeImageUrls(groups: VariantGroup[], selected: SelectedVariant[]): string[] {
  const urls: string[] = [];
  for (const item of selected) {
    const group = groups.find((entry) => entry.name === item.groupName);
    if (!group || group.imageMode !== "all") continue;
    const option = group.options.find((entry) => entry.label === item.option);
    if (option?.image) urls.push(option.image);
  }
  return urls;
}

export function applyVariantToOrderItem(input: {
  groups: VariantGroup[];
  isBump: boolean;
  selectedRaw: unknown;
  variantLabel?: unknown;
  rawName: string;
  productImage: string | null;
}):
  | { ok: false; message: string }
  | {
      ok: true;
      name: string;
      image: string | null;
      selectedVariants?: SelectedVariant[];
      variantLabel?: string;
    } {
  if (input.isBump || input.groups.length === 0) {
    return {
      ok: true,
      name: input.rawName,
      image: input.productImage,
    };
  }

  const selectedVariants = orderSelectedVariants(input.groups, input.selectedRaw);
  const message = variantSelectionMessage(input.groups, selectedVariants);
  if (message) return { ok: false, message };

  const clientLabel = String(input.variantLabel ?? "").trim();
  const variantLabel = clientLabel || buildVariantLabel(selectedVariants);
  const name = variantLabel && !input.rawName.includes(variantLabel)
    ? `${input.rawName} - ${variantLabel}`
    : input.rawName;

  return {
    ok: true,
    name,
    image: resolveVariantLineImage(input.groups, selectedVariants, input.productImage),
    selectedVariants,
    variantLabel: variantLabel || undefined,
  };
}

export function orderLineDisplayImage(
  item: { image?: unknown; selectedVariants?: unknown },
  catalogImage: string | null | undefined,
): string | null {
  const hasVariant = Array.isArray(item.selectedVariants) && item.selectedVariants.length > 0;
  const snapshot = String(item.image ?? "").trim();
  const catalog = String(catalogImage ?? "").trim();
  if (hasVariant) return snapshot || catalog || null;
  return catalog || snapshot || null;
}

export function migrateCartLine<T extends {
  id: string;
  productId?: string;
  isBump?: boolean;
  bumpProductId?: string;
  selectedVariants?: unknown;
}>(item: T): T {
  if (item.isBump) return item;
  const productId = cartCatalogProductId(item);
  const selected = readSelectedVariants(item.selectedVariants);
  if (selected.length === 0) {
    return item.productId === productId ? item : { ...item, productId };
  }
  const id = buildCartLineId(productId, selected);
  if (item.id === id && item.productId === productId) return item;
  return { ...item, id, productId };
}
