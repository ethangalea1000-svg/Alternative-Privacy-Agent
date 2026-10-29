export const IDENTITY_STORAGE_KEY = "apa.identity.v1";
export const MAX_PSEUDONYM_LENGTH = 40;
export const MAX_BIO_LENGTH = 240;
export const MAX_PROFILE_URL_LENGTH = 200;
export const IDENTITY_CHECKS = Object.freeze(["separate-real-name","not-personal-accounts","no-identifying-details","review-links"]);
export function emptyIdentity() {
  return { pseudonym: "", bio: "", githubUrl: "", websiteUrl: "", checklist: Object.fromEntries(IDENTITY_CHECKS.map((key) => [key, false])) };
}
function safeText(value, max) {
  return typeof value === "string" && value.length <= max && [...value].every((c) => { const n = c.charCodeAt(0); return n >= 32 && n !== 127; });
}
function safeUrl(value) {
  if (value === "") return true;
  if (typeof value !== "string" || value.length > MAX_PROFILE_URL_LENGTH || !value.startsWith("https://") || [...value].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127)) return false;
  try { const u = new URL(value); return u.protocol === "https:" && Boolean(u.hostname); } catch { return false; }
}
export function validateIdentity(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  if (!safeText(v.pseudonym, MAX_PSEUDONYM_LENGTH) || !safeText(v.bio, MAX_BIO_LENGTH) || !safeUrl(v.githubUrl) || !safeUrl(v.websiteUrl)) return false;
  if (!v.checklist || typeof v.checklist !== "object" || Array.isArray(v.checklist)) return false;
  return IDENTITY_CHECKS.every((key) => typeof v.checklist[key] === "boolean");
}
export function parseStoredIdentity(raw) {
  if (raw === null || raw === undefined || raw === "") return emptyIdentity();
  const v = JSON.parse(raw);
  if (!validateIdentity(v)) throw new TypeError("La fiche pseudonyme locale est invalide.");
  return { pseudonym: v.pseudonym, bio: v.bio, githubUrl: v.githubUrl, websiteUrl: v.websiteUrl,
    checklist: Object.fromEntries(IDENTITY_CHECKS.map((key) => [key, v.checklist[key]])) };
}
