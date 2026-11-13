const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const { seal, open, TokenError } = require("../src/token");

const keys = new Map([["k1", crypto.randomBytes(32)], ["k2", crypto.randomBytes(32)]]);
const modelId = crypto.randomBytes(32);
const emb = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i));

function make(extra = {}) {
  return seal({ embedding: emb, modelId, ttlDays: 90, keys, activeKid: "k1", ...extra }).token;
}

test("roundtrip conserva el embedding", () => {
  const out = open({ token: make(), modelId, keys });
  assert.strictEqual(out.embedding.length, 128);
  for (let i = 0; i < 128; i++) assert.ok(Math.abs(out.embedding[i] - emb[i]) < 1e-7);
});

test("dos tokens del mismo embedding son distintos (IV aleatorio)", () => {
  assert.notStrictEqual(make(), make());
});

test("un byte alterado invalida el token", () => {
  const t = make();
  const [p, kid, body] = t.split(".");
  const flipped = body.slice(0, 20) + (body[20] === "A" ? "B" : "A") + body.slice(21);
  assert.throws(() => open({ token: `${p}.${kid}.${flipped}`, modelId, keys }), (e) => e instanceof TokenError && e.code === "invalid");
});

test("cambiar el kid invalida el token (AAD)", () => {
  const [p, , body] = make().split(".");
  assert.throws(() => open({ token: `${p}.k2.${body}`, modelId, keys }), (e) => e.code === "invalid");
});

test("token de otro modelo -> model_mismatch", () => {
  assert.throws(() => open({ token: make(), modelId: crypto.randomBytes(32), keys }), (e) => e.code === "model_mismatch");
});

test("token vencido -> expired", () => {
  const t = make({ now: Date.now() - 100 * 86400 * 1000 });
  assert.throws(() => open({ token: t, modelId, keys }), (e) => e.code === "expired");
});

test("se descifra con una clave vieja tras rotar", () => {
  const t = make();
  const rotated = new Map([["k2", crypto.randomBytes(32)], ["k1", keys.get("k1")]]);
  assert.ok(open({ token: t, modelId, keys: rotated }).embedding.length === 128);
});

test("basura -> invalid", () => {
  for (const t of ["", "x", "pdm1.k1.!!!", "pdm1.k1.AAAA", "jwt.a.b", 42]) {
    assert.throws(() => open({ token: t, modelId, keys }), (e) => e.code === "invalid");
  }
});
