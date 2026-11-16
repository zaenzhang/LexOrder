import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { ActionError } from "@/lib/action-error";

function cursorKey(domain: Buffer) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new ActionError("分页配置不可用，请联系管理员");
  return createHash("sha256").update(domain).update(secret).digest();
}

/** Shared encryption only. Each caller validates its own payload and access scope. */
export function encodePaginationCursor(domainName: string, payload: unknown): string {
  const domain = Buffer.from(domainName);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cursorKey(domain), iv);
  cipher.setAAD(domain);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload))), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function decodePaginationCursor(domainName: string, token: string): unknown {
  const domain = Buffer.from(domainName);
  const key = cursorKey(domain);
  try {
    if (token.length > 1200 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error();
    const bytes = Buffer.from(token, "base64url");
    if (bytes.length < 29 || bytes.toString("base64url") !== token) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    decipher.setAAD(domain);
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
  } catch {
    throw new ActionError("分页位置已失效，请重新读取");
  }
}
