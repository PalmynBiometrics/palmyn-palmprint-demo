const path = require("path");
const express = require("express");

const { buildTensor, RoiError } = require("./roi");
const { seal, open, tokenFingerprint, TokenError } = require("./token");
const { cosine } = require("./model");
const { RateLimiter } = require("./ratelimit");
const { CONSENT, checkConsent } = require("./consent");
const { createStats, cleanClient, REASONS, MODES } = require("./stats");

// Todas las respuestas tienen la forma { code, result } y el status HTTP coincide con code.
const ok = (result) => ({ code: 200, result });
const fail = (code, error, message) => ({ code, result: { error, message } });

function send(res, r) {
  res.status(r.code).json(r);
}

function loadGeo(blockedRegions, log) {
  if (!blockedRegions.length) return null;
  try {
    const geoip = require("geoip-lite");
    return (ip) => {
      const g = geoip.lookup(ip);
      if (!g) return false;
      return blockedRegions.includes(g.country) || blockedRegions.includes(`${g.country}-${g.region}`);
    };
  } catch {
    log("[aviso] BLOCKED_REGIONS configurado pero geoip-lite no esta instalado: el bloqueo geografico queda desactivado");
    return null;
  }
}

// País (2 letras) a partir de la IP, para las estadísticas. La IP NO se guarda.
function loadCountry() {
  try {
    const geoip = require("geoip-lite");
    return (ip) => (geoip.lookup(ip) || {}).country || null;
  } catch {
    return () => null;
  }
}

function createApp({ config, model, log = console.log, stats }) {
  const app = express();
  const limiter = new RateLimiter();
  const isBlocked = loadGeo(config.blockedRegions, log);
  const countryOf = loadCountry();
  stats = stats || createStats({ config, log });

  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);

  app.use((req, res, next) => {
    res.set({
      // La API nunca se cachea; los estaticos pisan esto mas abajo (setHeaders).
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Opener-Policy": "same-origin",
    });
    const origin = req.get("origin");
    if (origin && config.corsOrigins.includes(origin)) {
      res.set({
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      });
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.use(express.json({ limit: "1mb" }));

  function guard(req, res, kind) {
    if (isBlocked && isBlocked(req.ip)) {
      send(res, fail(451, "region_blocked", "La demo no esta disponible en tu region"));
      return false;
    }
    const limit = kind === "enroll" ? config.rl.enrollPerHourIp : config.rl.verifyPerHourIp;
    if (!limiter.take(`ip:${kind}:${req.ip}`, limit)) {
      send(res, fail(429, "rate_limited", "Demasiados intentos, proba de nuevo mas tarde"));
      return false;
    }
    const consentErr = checkConsent(req.body && req.body.consent);
    if (consentErr) {
      send(res, fail(400, "consent_required", consentErr));
      return false;
    }
    return true;
  }

  app.get("/v1/health", (req, res) => {
    send(res, ok({ status: "ok", model: config.modelLabel, model_id: model.modelIdHex, frames: config.framesMax }));
  });

  app.get("/v1/consent", (req, res) => {
    send(res, ok(CONSENT));
  });

  app.post("/v1/enroll", async (req, res, next) => {
    try {
      if (!guard(req, res, "enroll")) return;
      const tensor = buildTensor(req.body.rois, { min: config.framesMin, max: config.framesMax });
      const tpl = await model.template(tensor);
      const t = seal({
        embedding: tpl,
        modelId: model.modelId,
        ttlDays: config.tokenTtlDays,
        keys: config.tokenKeys,
        activeKid: config.activeKid,
      });
      tpl.fill(0);
      send(res, ok({ token: t.token, expires_at: new Date(t.exp * 1000).toISOString(), model: config.modelLabel }));
    } catch (e) {
      next(e);
    }
  });

  app.post("/v1/verify", async (req, res, next) => {
    try {
      if (!guard(req, res, "verify")) return;
      const { token } = req.body;
      if (typeof token !== "string") return send(res, fail(400, "token_required", "falta el token"));
      if (!limiter.take(`tok:${tokenFingerprint(token)}`, config.rl.verifyPerHourToken)) {
        return send(res, fail(429, "rate_limited", "Demasiados intentos con este token, proba mas tarde"));
      }

      const enrolled = open({ token, modelId: model.modelId, keys: config.tokenKeys });
      const tensor = buildTensor(req.body.rois, { min: config.framesMin, max: config.framesMax });
      const query = await model.template(tensor);
      const score = cosine(enrolled.embedding, query);
      enrolled.embedding.fill(0);
      query.fill(0);

      const match = score >= config.simThreshold;
      const result = { match };
      if (config.returnScore === "coarse") result.score = Math.round(score * 10) / 10;

      if (req.body.share_stats === true) {
        stats.recordVerify({
          match,
          score: Math.round(score * 100) / 100,
          dias_desde_enrol: Math.max(0, Math.floor((Date.now() / 1000 - enrolled.iat) / 86400)),
          ...cleanClient(req.body.client),
          pais: countryOf(req.ip),
          modelo: config.modelLabel,
        });
      }
      send(res, ok(result));
    } catch (e) {
      next(e);
    }
  });

  // Fallos de captura del lado del celular (dorso, mano fuera de cuadro, etc.). Solo con la casilla
  // de estadísticas tildada. No lleva imágenes: solo el motivo y la categoría del dispositivo.
  app.post("/v1/stats/capture-fail", (req, res) => {
    if (isBlocked && isBlocked(req.ip)) return send(res, fail(451, "region_blocked", "La demo no esta disponible en tu region"));
    const consentErr = checkConsent(req.body && req.body.consent);
    if (consentErr) return send(res, fail(400, "consent_required", consentErr));
    const { reason, mode } = req.body;
    if (!REASONS.includes(reason) || !MODES.includes(mode)) return send(res, fail(400, "bad_request", "motivo o modo invalido"));
    if (req.body.share_stats !== true) return res.sendStatus(204);
    if (!limiter.take(`ip:fail:${req.ip}`, config.rlCaptureFailPerHourIp)) return res.sendStatus(204);
    stats.recordCaptureFail({ motivo: reason, modo: mode, ...cleanClient(req.body.client), pais: countryOf(req.ip), modelo: config.modelLabel });
    res.sendStatus(204);
  });

  // Pagina de prueba (solo local / opcional): la misma API sirve web/ en el mismo origen.
  if (config.serveWeb) {
    // Solo la pagina: todo lo que carga sale de este mismo origen (fuentes incluidas).
    // 'wasm-unsafe-eval' lo necesita MediaPipe para compilar su WASM.
    const CSP = [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob: mediastream:",
      "font-src 'self'",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; ");
    const pageHeaders = (res, file) => {
      res.set({
        "Content-Security-Policy": CSP,
        "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
        // html/js/css: revalidar siempre (cambian con cada deploy); fuentes y MediaPipe: 7 dias.
        "Cache-Control": /\.(woff2|wasm|task)$|vision_/.test(file) ? "public, max-age=604800" : "no-cache",
      });
    };
    // Assets de MediaPipe: fuera del repo (VENDOR_PATH) para que un redeploy no los borre.
    app.use("/vendor", express.static(config.vendorPath, { setHeaders: pageHeaders }));
    app.use(express.static(path.join(__dirname, "..", "web"), { index: "index.html", extensions: ["html"], setHeaders: pageHeaders }));
  }

  app.use((req, res) => send(res, fail(404, "not_found", "endpoint inexistente")));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof RoiError) return send(res, fail(422, "bad_roi", err.message));
    if (err instanceof TokenError) {
      const code = err.code === "invalid" ? 401 : 409;
      return send(res, fail(code, `token_${err.code}`, err.message));
    }
    if (err.type === "entity.too.large") return send(res, fail(413, "too_large", "request demasiado grande"));
    if (err.type === "entity.parse.failed") return send(res, fail(400, "bad_json", "JSON invalido"));
    log(`[error] ${req.method} ${req.path}: ${err.message}`);
    send(res, fail(500, "internal", "error interno"));
  });

  return app;
}

module.exports = { createApp };
