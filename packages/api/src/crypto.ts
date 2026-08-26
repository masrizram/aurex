/**
 * @aee/api — enkripsi simetris AES-256-GCM untuk API key provider AI.
 *
 * Tidak pernah menyimpan plaintext di DB; hanya ciphertext (iv|tag|cipher).
 * Kunci diturunkan dari env AEE_ADMIN_ENC_KEY (hex 64 = 32 byte) — bila tidak
 * diset gunakan turunan SHA-256 dari constant dev (SATU-SATUNYA fallback;
 * produksi WAJIB menset env agar key tidak dapat ditebak).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const IV_LEN = 12;   // GCM IV
const TAG_LEN = 16;  // GCM auth tag

function keyFromEnv(): Buffer {
  const raw = process.env.AEE_ADMIN_ENC_KEY;
  if (raw && /^[0-9a-fA-F]{64}$/.test(raw.trim())) {
    return Buffer.from(raw.trim(), "hex");
  }
  // Fallback dev deterministic. JANGAN dipakai di produksi tanpa env.
  return createHash("sha256").update(raw && raw.length > 0 ? raw : "aee-dev-enc-key").digest();
}

/** Encrypt plaintext → buffer iv(12) | tag(16) | ciphertext. */
export function encryptSecret(plaintext: string): Buffer {
  const key = keyFromEnv();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

/** Decrypt buffer iv(12) | tag(16) | ciphertext → plaintext (atau null bila rusak). */
export function decryptSecret(payload: Buffer): string | null {
  try {
    if (payload.length < IV_LEN + TAG_LEN) return null;
    const key = keyFromEnv();
    const iv = payload.subarray(0, IV_LEN);
    const tag = payload.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const data = payload.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null; // key berubah / ciphertext korup → jangan bocorkan error
  }
}

/** SHA-256 hex dari value — untuk "key tersimpan?" + hint tanpa mengekspos isi. */
export function hashSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
