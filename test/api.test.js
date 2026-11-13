// Test end-to-end con el modelo real y ROIs procesadas.
// Necesita el .onnx (MODEL_PATH o models/palm_subcenter.onnx) y una carpeta con una
// subcarpeta por identidad (TEST_ROI_DIR). Si falta alguno, se saltea.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROI_DIR = process.env.TEST_ROI_DIR || "";
const MODEL = process.env.MODEL_PATH || path.join(__dirname, "..", "models", "palm_subcenter.onnx");
const ready = fs.existsSync(MODEL) && ROI_DIR !== "" && fs.existsSync(ROI_DIR);

process.env.TOKEN_KEYS = `t1:${crypto.randomBytes(32).toString("hex")}`;
process.env.TOKEN_ACTIVE_KID = "t1";
process.env.MODEL_PATH = MODEL;
process.env.RL_VERIFY_PER_HOUR_TOKEN = "4";
process.env.RETURN_SCORE = "coarse";
process.env.STATS_ENABLED = "false";

const b64 = (f) => fs.readFileSync(f).toString("base64");

function rois(id, prefix, n = 3) {
  const dir = path.join(ROI_DIR, id);
  return fs.readdirSync(dir).filter((f) => f.includes(prefix)).slice(0, n).map((f) => b64(path.join(dir, f)));
}

test("flujo enroll / verify", { skip: !ready && "falta el modelo o TEST_ROI_DIR" }, async (t) => {
  const config = require("../src/config").load();
  const { createModel } = require("../src/model");
  const { createApp } = require("../src/app");
  const { CONSENT, REQUIRED_IDS } = require("../src/consent");

  const model = await createModel({ modelPath: config.modelPath, maxConcurrent: 2 });
  const server = createApp({ config, model, log: () => {} }).listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const consent = { version: CONSENT.version, accepted: true, items: REQUIRED_IDS };

  const post = async (p, body) => {
    const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };

  const ids = fs.readdirSync(ROI_DIR).sort();
  const [A, B] = ids;

  await t.test("sin consentimiento -> 400", async () => {
    const r = await post("/v1/enroll", { rois: rois(A, "_s1_") });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.result.error, "consent_required");
  });

  await t.test("falta una declaracion -> 400", async () => {
    const partial = { ...consent, items: REQUIRED_IDS.slice(0, -1) };
    const r = await post("/v1/enroll", { consent: partial, rois: rois(A, "_s1_") });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.result.error, "consent_required");
  });

  await t.test("cantidad de frames incorrecta -> 422", async () => {
    const r = await post("/v1/enroll", { consent, rois: rois(A, "_s1_", 2) });
    assert.strictEqual(r.status, 422);
  });

  const enr = await post("/v1/enroll", { consent, rois: rois(A, "_s1_") });
  assert.strictEqual(enr.status, 200, JSON.stringify(enr.body));
  const token = enr.body.result.token;
  assert.match(token, /^pdm1\.t1\./);

  await t.test("misma palma, otra sesion -> match", async () => {
    const r = await post("/v1/verify", { consent, token, rois: rois(A, "_s2_") });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.result.match, true, `score=${r.body.result.score}`);
  });

  await t.test("otra palma -> no match", async () => {
    const r = await post("/v1/verify", { consent, token, rois: rois(B, "_s2_") });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.result.match, false, `score=${r.body.result.score}`);
  });

  await t.test("token alterado -> 401", async () => {
    const bad = token.slice(0, -6) + (token.endsWith("AAAAAA") ? "BBBBBB" : "AAAAAA");
    const r = await post("/v1/verify", { consent, token: bad, rois: rois(A, "_s2_") });
    assert.strictEqual(r.status, 401);
  });

  await t.test("imagen plana -> 422", async () => {
    const flat = Buffer.alloc(224 * 224, 128).toString("base64");
    const r = await post("/v1/verify", { consent, token, rois: [flat, flat, flat] });
    assert.strictEqual(r.status, 422);
  });

  await t.test("limite por token -> 429", async () => {
    // ya se usaron 3 de 4 intentos de este token (match, no match, imagen plana)
    await post("/v1/verify", { consent, token, rois: rois(A, "_s2_") });
    const r = await post("/v1/verify", { consent, token, rois: rois(A, "_s2_") });
    assert.strictEqual(r.status, 429);
  });

  await t.test("fallo de captura: motivo invalido -> 400, valido -> 204", async () => {
    const bad = await fetch(base + "/v1/stats/capture-fail", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consent, share_stats: true, reason: "lo-que-sea", mode: "enroll" }) });
    assert.strictEqual(bad.status, 400);
    const good = await fetch(base + "/v1/stats/capture-fail", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consent, share_stats: true, reason: "back", mode: "enroll", client: { os: "android" } }) });
    assert.strictEqual(good.status, 204);
    const noConsent = await fetch(base + "/v1/stats/capture-fail", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ share_stats: true, reason: "back", mode: "enroll" }) });
    assert.strictEqual(noConsent.status, 400);
  });

  await t.test("health y consent", async () => {
    const h = await (await fetch(base + "/v1/health")).json();
    assert.strictEqual(h.result.status, "ok");
    const c = await (await fetch(base + "/v1/consent")).json();
    assert.strictEqual(c.result.version, CONSENT.version);
  });
});
