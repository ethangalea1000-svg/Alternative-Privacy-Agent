// Chiffrement optionnel des sauvegardes APA (WebCrypto, aucune dependance).
// Format conteneur : JSON { format:"APA-ENCRYPTED", version:1, kdf:{...}, cipher:{...}, data:"..." }
// Derivation PBKDF2-SHA256 250 000 iterations -> cle AES-GCM 256 bits. Sel et IV aleatoires a chaque export.

const FORMAT = "APA-ENCRYPTED";
const PBKDF2_ITERATIONS = 250000;
const MAX_CONTAINER_CHARS = 2 * 1024 * 1024;

function toBase64(bytes) {
  let binary = "";
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export function isEncryptedBackup(text) {
  try {
    const parsed = JSON.parse(text);
    return Boolean(parsed && parsed.format === FORMAT && typeof parsed.data === "string");
  } catch {
    return false;
  }
}

export async function encryptBackup(plaintext, password) {
  if (typeof password !== "string" || password.length < 12) throw new Error("Utilisez au moins 12 caractères pour le mot de passe.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return JSON.stringify({
    format: FORMAT,
    version: 1,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: PBKDF2_ITERATIONS, salt: toBase64(salt) },
    cipher: { name: "AES-GCM", iv: toBase64(iv) },
    data: toBase64(ciphertext)
  }, null, 2);
}

export async function decryptBackup(containerText, password) {
  if (typeof containerText !== "string" || containerText.length > MAX_CONTAINER_CHARS) throw new Error("Sauvegarde trop volumineuse.");
  const container = JSON.parse(containerText);
  if (!container || container.format !== FORMAT || container.version !== 1 ||
      container.kdf?.name !== "PBKDF2" || container.kdf?.hash !== "SHA-256" ||
      container.kdf?.iterations !== PBKDF2_ITERATIONS || container.cipher?.name !== "AES-GCM") {
    throw new Error("Format de sauvegarde chiffré non pris en charge.");
  }
  if (typeof container.kdf.salt !== "string" || typeof container.cipher.iv !== "string" ||
      typeof container.data !== "string") throw new Error("Sauvegarde invalide.");
  const iterations = PBKDF2_ITERATIONS;
  let salt, iv, data;
  try {
    salt = fromBase64(container.kdf.salt);
    iv = fromBase64(container.cipher.iv);
    data = fromBase64(container.data);
  } catch { throw new Error("Sauvegarde invalide."); }
  if (salt.length !== 16 || iv.length !== 12 || data.length < 16) throw new Error("Sauvegarde invalide.");
  const key = await deriveKey(password, salt, iterations);
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error("Mot de passe incorrect ou sauvegarde altérée.");
  }
}
