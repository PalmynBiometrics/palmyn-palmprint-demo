// Decodifica los ROIs que manda el cliente y arma el tensor del modelo.
// Cada ROI es base64 de:
//   - 50176 bytes crudos (224x224 gris uint8, salida de palm_preproc_purejs.js), o
//   - un PNG 224x224 (gris o color; el color se pasa a gris con la luma de OpenCV).
// Normalizacion identica al entrenamiento / app: gris -> 3 canales + ImageNet.
const { PNG } = require("pngjs");

const SIZE = 224;
const N = SIZE * SIZE;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
const MAX_B64 = 300_000;
const MIN_STD = 4; // imagen casi plana = basura (o sondeo del modelo)

class RoiError extends Error {}

function isPng(buf) {
  return buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a;
}

function decodeOne(b64, idx) {
  if (typeof b64 !== "string" || !b64.length || b64.length > MAX_B64) {
    throw new RoiError(`roi ${idx}: tamano invalido`);
  }
  const clean = b64.startsWith("data:") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const buf = Buffer.from(clean, "base64");

  if (!isPng(buf)) {
    if (buf.length !== N) throw new RoiError(`roi ${idx}: se esperaban ${N} bytes gris o un PNG ${SIZE}x${SIZE}`);
    return buf;
  }

  let png;
  try {
    png = PNG.sync.read(buf);
  } catch {
    throw new RoiError(`roi ${idx}: PNG invalido`);
  }
  if (png.width !== SIZE || png.height !== SIZE) throw new RoiError(`roi ${idx}: el PNG debe ser ${SIZE}x${SIZE}`);
  // pngjs siempre devuelve RGBA
  const gray = Buffer.alloc(N);
  const d = png.data;
  for (let i = 0; i < N; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    gray[i] = (r * 4899 + g * 9617 + b * 1868 + 8192) >> 14;
  }
  d.fill(0);
  return gray;
}

function stdOf(gray) {
  let s = 0, s2 = 0;
  for (let i = 0; i < N; i++) { s += gray[i]; s2 += gray[i] * gray[i]; }
  const m = s / N;
  return Math.sqrt(Math.max(0, s2 / N - m * m));
}

function buildTensor(rois, { min, max }) {
  if (!Array.isArray(rois)) throw new RoiError("rois debe ser un array");
  if (rois.length < min || rois.length > max) {
    throw new RoiError(min === max ? `se esperan ${min} rois` : `se esperan entre ${min} y ${max} rois`);
  }
  const batch = rois.length;
  const data = new Float32Array(batch * 3 * N);
  rois.forEach((b64, k) => {
    const gray = decodeOne(b64, k);
    if (stdOf(gray) < MIN_STD) { gray.fill(0); throw new RoiError(`roi ${k}: imagen sin contenido`); }
    const base = k * 3 * N;
    for (let i = 0; i < N; i++) {
      const v = gray[i] / 255;
      data[base + i] = (v - MEAN[0]) / STD[0];
      data[base + N + i] = (v - MEAN[1]) / STD[1];
      data[base + 2 * N + i] = (v - MEAN[2]) / STD[2];
    }
    gray.fill(0);
  });
  return { data, dims: [batch, 3, SIZE, SIZE] };
}

module.exports = { buildTensor, RoiError, SIZE };
