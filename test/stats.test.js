// Estadísticas: validación de lo que manda el navegador, destino archivo y destino MySQL.
// El test de MySQL corre solo si hay TEST_MYSQL_URL (ej. mysql://root:@127.0.0.1:3306/palmyn_stats_test).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createStats, cleanClient } = require("../src/stats");

const quiet = () => {};

test("cleanClient: solo categorías permitidas", () => {
  assert.deepStrictEqual(cleanClient({ os: "android", device: "mobile", camera: "environment", resolution: "1280x720" }),
    { so: "android", dispositivo: "mobile", camara: "environment", resolucion: "1280x720" });
  // basura o intentos de meter texto libre -> valores por defecto
  assert.deepStrictEqual(cleanClient({ os: "Mozilla/5.0 (X11)", device: "<script>", camera: 7, resolution: "1280x720; DROP" }),
    { so: "other", dispositivo: "other", camara: "unknown", resolucion: null });
  assert.deepStrictEqual(cleanClient(null), { so: "other", dispositivo: "other", camara: "unknown", resolucion: null });
});

test("apagadas: no escribe nada", async () => {
  const s = createStats({ config: { stats: { enabled: false } }, log: quiet });
  assert.strictEqual(s.enabled, false);
  s.recordVerify({}); s.recordCaptureFail({});
});

test("destino archivo: una línea por evento, sin IP", async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pst-")), "s.jsonl");
  const s = createStats({ config: { stats: { enabled: true, path: f, db: null, retentionDays: 365 } }, log: quiet });
  s.recordVerify({ match: true, score: 0.71, dias_desde_enrol: 2, so: "ios", dispositivo: "mobile", camara: "environment", resolucion: null, pais: "AR", modelo: "m" });
  s.recordCaptureFail({ motivo: "back", modo: "enroll", so: "android", dispositivo: "mobile", camara: "environment", resolucion: null, pais: null, modelo: "m" });
  for (let i = 0; i < 50 && !(fs.existsSync(f) && fs.readFileSync(f, "utf8").trim().split("\n").length === 2); i++) await new Promise((r) => setTimeout(r, 20));
  const rows = fs.readFileSync(f, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepStrictEqual(rows.map((r) => r.tipo).sort(), ["fallo_captura", "verificacion"]);
  assert.ok(rows.every((r) => !("ip" in r)));
});

const MYSQL_URL = process.env.TEST_MYSQL_URL;
test("destino MySQL: crea tablas, inserta y purga", { skip: !MYSQL_URL && "sin TEST_MYSQL_URL" }, async () => {
  const u = new URL(MYSQL_URL);
  const db = { host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), name: u.pathname.slice(1) };
  const mysql = require("mysql2/promise");
  const admin = await mysql.createConnection({ host: db.host, port: db.port, user: db.user, password: db.password });
  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${db.name}\``);
  await admin.query(`DROP TABLE IF EXISTS \`${db.name}\`.verificaciones, \`${db.name}\`.fallos_captura`);

  const s = createStats({ config: { stats: { enabled: true, db, retentionDays: 365 } }, log: quiet });
  await s.ready;
  await s.recordVerify({ match: true, score: 0.71, dias_desde_enrol: 2, so: "ios", dispositivo: "mobile", camara: "environment", resolucion: "1280x720", pais: "AR", modelo: "m" });
  await s.recordCaptureFail({ motivo: "back", modo: "enroll", so: "android", dispositivo: "mobile", camara: "environment", resolucion: null, pais: null, modelo: "m" });

  const [[v]] = await admin.query(`SELECT * FROM \`${db.name}\`.verificaciones`);
  assert.strictEqual(v.coincide, 1); assert.strictEqual(Number(v.score), 0.71); assert.strictEqual(v.pais, "AR");
  const [[f]] = await admin.query(`SELECT * FROM \`${db.name}\`.fallos_captura`);
  assert.strictEqual(f.motivo, "back");
  const cols = (await admin.query(`SHOW COLUMNS FROM \`${db.name}\`.verificaciones`))[0].map((c) => c.Field);
  assert.ok(!cols.some((c) => /ip|token|user/i.test(c)), "no debe haber columnas de IP/token/usuario");

  // purga: una fila de hace 400 días desaparece con la retención de 365
  await admin.query(`INSERT INTO \`${db.name}\`.verificaciones (ts, coincide, score, so, dispositivo, camara, modelo) VALUES (UTC_TIMESTAMP() - INTERVAL 400 DAY, 0, 0.1, 'other', 'other', 'unknown', 'm')`);
  await s.close();
  const s2 = createStats({ config: { stats: { enabled: true, db, retentionDays: 365 } }, log: quiet });
  await s2.ready;
  const [[{ n }]] = await admin.query(`SELECT COUNT(*) n FROM \`${db.name}\`.verificaciones`);
  assert.strictEqual(Number(n), 1);
  await s2.close();
  await admin.query(`DROP DATABASE \`${db.name}\``);
  await admin.end();
});
