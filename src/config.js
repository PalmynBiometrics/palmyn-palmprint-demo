const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const env = process.env;

function int(name, def) {
  const v = env[name];
  if (v === undefined || v === "") return def;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`${name} must be an integer`);
  return n;
}

function float(name, def) {
  const v = env[name];
  if (v === undefined || v === "") return def;
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
}

function bool(name, def) {
  const v = env[name];
  if (v === undefined || v === "") return def;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function list(name) {
  return (env[name] || "").split(",").map((s) => s.trim()).filter(Boolean);
}

// TOKEN_KEYS="k2:<64 hex>,k1:<64 hex>"  — la activa se elige con TOKEN_ACTIVE_KID.
// Las viejas se mantienen para poder descifrar tokens emitidos antes de rotar.
function parseKeys() {
  const keys = new Map();
  for (const item of list("TOKEN_KEYS")) {
    const [kid, hex] = item.split(":");
    if (!/^[a-z0-9]{1,8}$/.test(kid || "")) throw new Error(`TOKEN_KEYS: kid invalido "${kid}"`);
    if (!/^[0-9a-f]{64}$/i.test(hex || "")) throw new Error(`TOKEN_KEYS: la clave de "${kid}" debe ser 64 hex (32 bytes)`);
    keys.set(kid, Buffer.from(hex, "hex"));
  }
  return keys;
}

function load() {
  const tokenKeys = parseKeys();
  const activeKid = env.TOKEN_ACTIVE_KID || [...tokenKeys.keys()][0];
  if (!tokenKeys.size) throw new Error("Falta TOKEN_KEYS (cada clave: 64 hex, por ejemplo con: openssl rand -hex 32)");
  if (!tokenKeys.has(activeKid)) throw new Error(`TOKEN_ACTIVE_KID "${activeKid}" no esta en TOKEN_KEYS`);

  const framesMin = int("FRAMES_MIN", 3);
  const framesMax = int("FRAMES_MAX", 3);
  if (framesMin < 1 || framesMax < framesMin || framesMax > 8) throw new Error("FRAMES_MIN/FRAMES_MAX fuera de rango (1..8)");

  return {
    port: int("PORT", 3000),
    trustProxy: int("TRUST_PROXY", 1),
    corsOrigins: list("CORS_ORIGINS"),

    modelPath: path.resolve(env.MODEL_PATH || path.join(__dirname, "..", "models", "palm_subcenter.onnx")),
    modelLabel: env.MODEL_LABEL || "palm_subcenter",
    simThreshold: float("SIM_THRESHOLD", 0.512),
    maxConcurrentInference: int("MAX_CONCURRENT_INFERENCE", 2),

    framesMin,
    framesMax,

    tokenKeys,
    activeKid,
    tokenTtlDays: int("TOKEN_TTL_DAYS", 90),

    // none = solo match:true/false · coarse = ademas el score redondeado a 1 decimal
    serveWeb: bool("SERVE_WEB", false),
    vendorPath: env.VENDOR_PATH ? path.resolve(env.VENDOR_PATH) : path.join(__dirname, "..", "web", "vendor"),
    returnScore: (env.RETURN_SCORE || "none").toLowerCase(),

    rl: {
      enrollPerHourIp: int("RL_ENROLL_PER_HOUR_IP", 5),
      verifyPerHourIp: int("RL_VERIFY_PER_HOUR_IP", 20),
      verifyPerHourToken: int("RL_VERIFY_PER_HOUR_TOKEN", 10),
    },

    // Bloqueo geografico best-effort por IP (ej. "US-IL,US-TX,US-WA"). Requiere geoip-lite.
    blockedRegions: list("BLOCKED_REGIONS").map((s) => s.toUpperCase()),

    // Estadísticas anónimas opt-in. Con STATS_DB_NAME van a MySQL; si no, a un archivo JSONL.
    stats: {
      enabled: bool("STATS_ENABLED", false),
      path: path.resolve(env.STATS_PATH || path.join(__dirname, "..", "data", "stats.jsonl")),
      retentionDays: int("STATS_RETENTION_DAYS", 365),
      db: env.STATS_DB_NAME
        ? {
            host: env.STATS_DB_HOST || "127.0.0.1",   // en Hostinger: 127.0.0.1 (localhost puede resolver a IPv6)
            port: int("STATS_DB_PORT", 3306),
            name: env.STATS_DB_NAME,
            user: env.STATS_DB_USER,
            password: env.STATS_DB_PASSWORD || "",
          }
        : null,
    },
    rlCaptureFailPerHourIp: int("RL_CAPTURE_FAIL_PER_HOUR_IP", 60),
  };
}

module.exports = { load };
