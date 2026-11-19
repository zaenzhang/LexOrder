import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { ActionError } from "@/lib/action-error";

const ALGORITHM = "AES-256-GCM" as const;
const KEY_LENGTH = 32; // 256 bit
const IV_LENGTH = 12; // 96 bit recommended for GCM
const AUTH_TAG_LENGTH = 16;

let cachedKey: Buffer | null = null;

export function getStorageEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.STORAGE_ENCRYPTION_KEY;
  if (!raw) {
    throw new ActionError("STORAGE_ENCRYPTION_KEY 未设置。在 .env 用 openssl rand -base64 32 生成");
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== KEY_LENGTH) {
    throw new ActionError(
      `STORAGE_ENCRYPTION_KEY 长度错误：期望 32 字节（base64 编码后约 44 字符），实际 ${buf.length}`
    );
  }
  cachedKey = buf;
  return cachedKey;
}

/**
 * 加密一个 Buffer，返回 ciphertext / iv / authTag（均为 Buffer，调用者负责 base64）。
 */
export function encryptBuffer(plain: Buffer): {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  algorithm: string;
} {
  return encryptWithIv(plain, randomBytes(IV_LENGTH));
}

function encryptWithIv(plain: Buffer, iv: Buffer) {
  const cipher = createCipheriv("aes-256-gcm", getStorageEncryptionKey(), iv, {
    authTagLength: AUTH_TAG_LENGTH
  });
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: ct, iv, authTag: tag, algorithm: ALGORITHM };
}

// Only the original plaintext may reuse a reserved GCM envelope after a failed upload.
export function restoreEncryptedOriginal(plain: Buffer, original: { size: number; sha256: string; iv: string; authTag: string }) {
  if (plain.length !== original.size || sha256(plain) !== original.sha256) throw new ActionError("重传原件与上传登记不一致");
  const encrypted = encryptWithIv(plain, Buffer.from(original.iv, "base64"));
  if (encrypted.authTag.toString("base64") !== original.authTag) throw new ActionError("无法核对原上传的加密登记");
  return encrypted.ciphertext;
}

/**
 * 解密。iv / authTag 是 base64。
 */
export function decryptBuffer(
  ciphertext: Buffer,
  ivBase64: string,
  authTagBase64: string
): Buffer {
  const iv = Buffer.from(ivBase64, "base64");
  const authTag = Buffer.from(authTagBase64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", getStorageEncryptionKey(), iv, {
    authTagLength: AUTH_TAG_LENGTH
  });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
