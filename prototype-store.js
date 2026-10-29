export const STORAGE_KEY = "apa.aliases.v1";
export const CATEGORIES = Object.freeze(["achats", "projets", "public", "personnel"]);
export const STATUSES = Object.freeze(["planned", "active", "paused"]);
export const MAX_NAME_LENGTH = 48;
export const MAX_SITE_LENGTH = 120;
export const MAX_NOTES_LENGTH = 1000;

export function validateAlias(item) {
  return Boolean(item && typeof item.id === "string" && item.id.length > 0 &&
    typeof item.name === "string" && item.name.trim().length > 0 &&
    item.name.length <= MAX_NAME_LENGTH &&
    typeof item.label === "string" && /^[a-z0-9-]{1,40}$/.test(item.label) &&
    CATEGORIES.includes(item.category) && STATUSES.includes(item.status) &&
    typeof item.createdAt === "string" && !Number.isNaN(Date.parse(item.createdAt)) &&
    typeof (item.site ?? "") === "string" && item.site.length <= MAX_SITE_LENGTH &&
    !/[\u0000-\u001f\u007f]/.test(item.site ?? "") &&
    typeof (item.notes ?? "") === "string" && item.notes.length <= MAX_NOTES_LENGTH &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(item.notes ?? ""));
}

export function normalizeAlias(item) {
  return {
    ...item,
    site: typeof item.site === "string" ? item.site.slice(0, MAX_SITE_LENGTH) : "",
    notes: typeof item.notes === "string" ? item.notes.slice(0, MAX_NOTES_LENGTH) : ""
  };
}

export function parseStoredAliases(raw) {
  if (raw === null || raw === undefined || raw === "") return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new TypeError("Le fichier de données doit contenir une liste d’alias.");
  return parsed.filter(validateAlias).map(normalizeAlias);
}

export function serializeAliases(aliases) {
  if (!Array.isArray(aliases) || !aliases.every(validateAlias)) {
    throw new TypeError("Les données contiennent un alias invalide.");
  }
  return JSON.stringify({ format: "APA-LOCAL-BACKUP", version: 1, exportedAt: new Date().toISOString(), aliases }, null, 2);
}

export function parseBackup(text) {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) {
    const aliases = parsed.filter(validateAlias).map(normalizeAlias);
    if (aliases.length !== parsed.length) throw new TypeError("La sauvegarde contient des entrées invalides.");
    return aliases;
  }
  if (!parsed || parsed.format !== "APA-LOCAL-BACKUP" || parsed.version !== 1 || !Array.isArray(parsed.aliases)) {
    throw new TypeError("Format de sauvegarde APA non reconnu.");
  }
  const aliases = parsed.aliases.filter(validateAlias).map(normalizeAlias);
  if (aliases.length !== parsed.aliases.length) throw new TypeError("La sauvegarde contient des entrées invalides.");
  return aliases;
}

export function mergeImportedAliases(current, imported) {
  const merged = new Map(current.map((item) => [item.id, normalizeAlias(item)]));
  for (const item of imported) merged.set(item.id, normalizeAlias(item));
  return [...merged.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function updateAlias(aliases, id, changes) {
  const index = aliases.findIndex((item) => item.id === id);
  if (index < 0) return aliases;
  const next = { ...aliases[index], ...changes, id: aliases[index].id, label: aliases[index].label, createdAt: aliases[index].createdAt, updatedAt: new Date().toISOString() };
  if (!validateAlias(next)) throw new TypeError("Les informations saisies sont invalides.");
  return aliases.map((item, i) => i === index ? next : item);
}
