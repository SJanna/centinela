import { createHash } from "node:crypto";

/** sha256 en hexadecimal de los bytes tal como llegaron. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Base64 sin copiar el buffer (respeta byteOffset si los bytes son una vista). */
export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

/** Vista Buffer de los mismos bytes, sin copiar. */
export function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
