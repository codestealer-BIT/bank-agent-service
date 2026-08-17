export function normalizeEmailForLookup(email: string): string {
  return email.trim().normalize("NFKC").toLowerCase();
}

export function normalizePhoneForLookup(phone: string): string {
  return phone.trim().replace(/[\s()-]/g, "");
}

export function normalizeLoginIdentifier(identifier: string): string {
  const normalized = identifier.trim().normalize("NFKC");
  if (normalized.includes("@")) return normalizeEmailForLookup(normalized);
  if (/^[+\d\s()-]+$/.test(normalized)) {
    return normalizePhoneForLookup(normalized);
  }
  return normalized.toLowerCase();
}
