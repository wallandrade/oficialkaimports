const REFERRAL_CODE_KEY = "affiliateRefCode";

export function normalizeRefCode(input: string): string {
  return input.trim().toUpperCase();
}

export function storeReferralCode(code: string): void {
  const normalized = normalizeRefCode(code);
  if (!normalized || typeof window === "undefined") return;
  localStorage.setItem(REFERRAL_CODE_KEY, normalized);
}

export function getStoredReferralCode(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(REFERRAL_CODE_KEY) || "";
}

export function captureReferralFromCurrentUrl(): string {
  if (typeof window === "undefined") return "";

  const params = new URLSearchParams(window.location.search);
  const ref = normalizeRefCode(params.get("ref") || "");
  if (ref) {
    storeReferralCode(ref);
  }

  return ref;
}
