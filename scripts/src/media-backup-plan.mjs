// Pure diff for the incremental media mirror. No network, no deletes.

export const MEDIA_DEST_PREFIX = "media/";

export const MEDIA_SOURCE_PREFIXES = [
  "products/",
  "tracking-labels/",
  "whatsapp-groups/",
  "site-settings/",
];

export const MEDIA_COPY_CONCURRENCY = 4;

function destKeyFor(sourceKey) {
  return `${MEDIA_DEST_PREFIX}${sourceKey}`;
}

/**
 * Compare source objects with one destination listing.
 * Same key (under media/) and same size stays. Anything missing or a different
 * size is copied. Destination-only keys are left in place.
 *
 * @param {Array<{ key?: string, size?: number }>} source
 * @param {Array<{ key?: string, size?: number }>} destination
 */
export function planMediaCopy(source, destination) {
  const destSize = new Map();
  for (const item of destination || []) {
    if (!item || typeof item.key !== "string" || !item.key) continue;
    destSize.set(item.key, Number(item.size) || 0);
  }

  const sourceSize = new Map();
  for (const item of source || []) {
    if (!item || typeof item.key !== "string" || !item.key || item.key.endsWith("/")) continue;
    sourceSize.set(item.key, Number(item.size) || 0);
  }

  const copy = [];
  let present = 0;
  for (const [key, size] of sourceSize) {
    const destKey = destKeyFor(key);
    if (destSize.get(destKey) === size) {
      present += 1;
      continue;
    }
    copy.push({ key, destKey, size });
  }

  return {
    total: sourceSize.size,
    present,
    missing: copy.length,
    copy,
  };
}
