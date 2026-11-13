// Token de enrolamiento: el template vive cifrado del lado del usuario, el servidor no guarda nada.
//
//   pdm1.<kid>.<base64url( iv[12] | ciphertext | tag[16] )>
//
// Plaintext (binario, little-endian):
//   [0]      version = 1
//   [1..8]   model_id (8 bytes del sha256 del .onnx) -> un token de otro modelo se rechaza
//   [9..12]  iat (uint32, segundos unix)
//   [13..16] exp (uint32, segundos unix)
//   [17]     dim (uint8)
//   [18..]   embedding float32 * dim
//
// AES-256-GCM con AAD = "pdm1.<kid>": no se puede cambiar el kid ni el prefijo sin romper el tag.
const crypto = require("crypto");

const PREFIX = "pdm1";
const PT_VERSION = 1;
const HEADER = 18;

class TokenError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // "invalid" | "expired" | "model_mismatch"
  }
}

function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s) {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new TokenError("invalid", "token mal formado");
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function seal({ embedding, modelId, ttlDays, keys, activeKid, now = Date.now() }) {
  const dim = embedding.length;
  if (dim < 1 || dim > 255) throw new Error("dim fuera de rango");
  const iat = Math.floor(now / 1000);
  const exp = iat + ttlDays * 86400;

  const pt = Buffer.alloc(HEADER + dim * 4);
  pt.writeUInt8(PT_VERSION, 0);
  modelId.copy(pt, 1, 0, 8);
  pt.writeUInt32LE(iat, 9);
  pt.writeUInt32LE(exp, 13);
  pt.writeUInt8(dim, 17);
  for (let i = 0; i < dim; i++) pt.writeFloatLE(embedding[i], HEADER + i * 4);

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keys.get(activeKid), iv);
  cipher.setAAD(Buffer.from(`${PREFIX}.${activeKid}`));
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  pt.fill(0);

  return { token: `${PREFIX}.${activeKid}.${b64url(Buffer.concat([iv, ct, tag]))}`, iat, exp };
}

function open({ token, modelId, keys, now = Date.now() }) {
  if (typeof token !== "string" || token.length > 4096) throw new TokenError("invalid", "token mal formado");
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) throw new TokenError("invalid", "token mal formado");
  const [, kid, body] = parts;
  const key = keys.get(kid);
  if (!key) throw new TokenError("invalid", "token invalido");

  const raw = fromB64url(body);
  if (raw.length < 12 + HEADER + 4 + 16) throw new TokenError("invalid", "token mal formado");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const ct = raw.subarray(12, raw.length - 16);

  let pt;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(`${PREFIX}.${kid}`));
    decipher.setAuthTag(tag);
    pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new TokenError("invalid", "token invalido");
  }

  try {
    if (pt.readUInt8(0) !== PT_VERSION) throw new TokenError("invalid", "version de token no soportada");
    const exp = pt.readUInt32LE(13);
    if (Math.floor(now / 1000) > exp) throw new TokenError("expired", "token vencido, volve a enrolarte");
    if (!crypto.timingSafeEqual(pt.subarray(1, 9), modelId.subarray(0, 8))) {
      throw new TokenError("model_mismatch", "el modelo cambio, volve a enrolarte");
    }
    const iat = pt.readUInt32LE(9);
    const dim = pt.readUInt8(17);
    if (pt.length !== HEADER + dim * 4) throw new TokenError("invalid", "token mal formado");
    const embedding = new Float32Array(dim);
    for (let i = 0; i < dim; i++) embedding[i] = pt.readFloatLE(HEADER + i * 4);
    return { embedding, iat, exp, kid };
  } finally {
    pt.fill(0);
  }
}

// Id estable del token para rate limiting, sin guardar el token.
function tokenFingerprint(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex").slice(0, 32);
}

module.exports = { seal, open, tokenFingerprint, TokenError };
