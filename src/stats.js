// Estadísticas anónimas (opt-in). Nunca se guardan IP, token, imágenes ni embeddings.
// Destino: MySQL si hay STATS_DB_NAME; si no, un archivo JSONL (STATS_PATH), útil en local.
// Si la base falla, se loguea y la demo sigue funcionando: una estadística perdida no rompe nada.
"use strict";
const fs = require("fs");
const path = require("path");

// Valores permitidos: el navegador puede mandar cualquier cosa, guardamos solo esto.
const OS = ["android", "ios", "windows", "macos", "linux", "chromeos", "other"];
const DEVICE = ["mobile", "tablet", "desktop", "other"];
const CAMERA = ["user", "environment", "unknown"];
const REASONS = ["no_hand", "back", "side", "out_of_frame", "unstable"];
const MODES = ["enroll", "verify"];

const pick = (v, allowed, def) => (allowed.includes(v) ? v : def);

// Datos del dispositivo que manda el navegador, reducidos a categorías (no identifican a nadie).
function cleanClient(c) {
  c = c && typeof c === "object" ? c : {};
  const res = typeof c.resolution === "string" && /^\d{2,5}x\d{2,5}$/.test(c.resolution) ? c.resolution : null;
  return {
    so: pick(c.os, OS, "other"),
    dispositivo: pick(c.device, DEVICE, "other"),
    camara: pick(c.camera, CAMERA, "unknown"),
    resolucion: res,
  };
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS verificaciones (
     id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
     ts DATETIME NOT NULL,
     coincide TINYINT(1) NOT NULL,
     score DECIMAL(4,2) NOT NULL,
     dias_desde_enrol SMALLINT UNSIGNED NULL,
     so VARCHAR(10) NOT NULL,
     dispositivo VARCHAR(10) NOT NULL,
     camara VARCHAR(12) NOT NULL,
     resolucion VARCHAR(11) NULL,
     pais CHAR(2) NULL,
     modelo VARCHAR(40) NOT NULL,
     INDEX (ts)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS fallos_captura (
     id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
     ts DATETIME NOT NULL,
     motivo VARCHAR(16) NOT NULL,
     modo VARCHAR(8) NOT NULL,
     so VARCHAR(10) NOT NULL,
     dispositivo VARCHAR(10) NOT NULL,
     camara VARCHAR(12) NOT NULL,
     resolucion VARCHAR(11) NULL,
     pais CHAR(2) NULL,
     modelo VARCHAR(40) NOT NULL,
     INDEX (ts)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

function createStats({ config, log = console.log }) {
  const s = config.stats;
  if (!s.enabled) return { enabled: false, recordVerify() {}, recordCaptureFail() {}, ready: Promise.resolve(), close: async () => {} };

  // ── destino archivo (local) ──
  if (!s.db) {
    const write = (tipo, row) =>
      fs.mkdir(path.dirname(s.path), { recursive: true }, () =>
        fs.appendFile(s.path, JSON.stringify({ tipo, ...row }) + "\n", (e) => e && log(`[stats] ${e.message}`)));
    return {
      enabled: true,
      backend: "archivo",
      ready: Promise.resolve(),
      recordVerify: (row) => write("verificacion", row),
      recordCaptureFail: (row) => write("fallo_captura", row),
      close: async () => {},
    };
  }

  // ── destino MySQL ──
  const mysql = require("mysql2/promise");
  const pool = mysql.createPool({
    host: s.db.host, port: s.db.port, user: s.db.user, password: s.db.password, database: s.db.name,
    connectionLimit: 3, timezone: "Z", connectTimeout: 5000,
  });
  const days = s.retentionDays;
  const purge = async () => {
    if (!(days > 0)) return;
    for (const t of ["verificaciones", "fallos_captura"]) {
      await pool.query(`DELETE FROM ${t} WHERE ts < UTC_TIMESTAMP() - INTERVAL ? DAY`, [days]);
    }
  };
  const ready = (async () => {
    for (const sql of SCHEMA) await pool.query(sql);
    await purge();
    log(`[stats] MySQL listo (${s.db.name}) · retención ${days > 0 ? days + " días" : "sin límite"}`);
  })().catch((e) => log(`[stats] MySQL no disponible: ${e.message}`));
  const timer = setInterval(() => purge().catch((e) => log(`[stats] purga: ${e.message}`)), 24 * 3600 * 1000);
  timer.unref();

  const insert = (sql, vals) => ready.then(() => pool.execute(sql, vals)).catch((e) => log(`[stats] ${e.message}`));
  return {
    enabled: true,
    backend: "mysql",
    ready,
    recordVerify: (r) => insert(
      "INSERT INTO verificaciones (ts, coincide, score, dias_desde_enrol, so, dispositivo, camara, resolucion, pais, modelo) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [new Date(), r.match ? 1 : 0, r.score, r.dias_desde_enrol, r.so, r.dispositivo, r.camara, r.resolucion, r.pais, r.modelo]),
    recordCaptureFail: (r) => insert(
      "INSERT INTO fallos_captura (ts, motivo, modo, so, dispositivo, camara, resolucion, pais, modelo) VALUES (?,?,?,?,?,?,?,?,?)",
      [new Date(), r.motivo, r.modo, r.so, r.dispositivo, r.camara, r.resolucion, r.pais, r.modelo]),
    close: async () => { clearInterval(timer); await pool.end(); },
  };
}

module.exports = { createStats, cleanClient, REASONS, MODES };
