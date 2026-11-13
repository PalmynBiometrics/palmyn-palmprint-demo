const fs = require("fs");
const crypto = require("crypto");

function loadOrt() {
  try {
    return { ort: require("onnxruntime-node"), backend: "onnxruntime-node" };
  } catch (e) {
    // Si el hosting no acepta el binario nativo, el runtime WASM tambien corre en Node.
    try {
      const ort = require("onnxruntime-web");
      ort.env.wasm.numThreads = 1;
      return { ort, backend: "onnxruntime-web (wasm)" };
    } catch {
      throw new Error(`No se pudo cargar onnxruntime-node (${e.message}) ni onnxruntime-web`);
    }
  }
}

class Semaphore {
  constructor(n) { this.n = n; this.queue = []; }
  async acquire() {
    if (this.n > 0) { this.n--; return; }
    await new Promise((r) => this.queue.push(r));
  }
  release() {
    const next = this.queue.shift();
    if (next) next(); else this.n++;
  }
}

function l2(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

async function createModel({ modelPath, maxConcurrent }) {
  if (!fs.existsSync(modelPath)) throw new Error(`No existe el modelo en MODEL_PATH=${modelPath}`);
  const bytes = fs.readFileSync(modelPath);
  const modelId = crypto.createHash("sha256").update(bytes).digest();
  const { ort, backend } = loadOrt();
  const session = await ort.InferenceSession.create(bytes);
  const inName = session.inputNames[0];
  const outName = session.outputNames[0];
  const sem = new Semaphore(Math.max(1, maxConcurrent));

  // Corre el batch de frames y devuelve el template: promedio de los embeddings + L2,
  // así varios frames se fusionan en una sola plantilla.
  async function template({ data, dims }) {
    await sem.acquire();
    let out;
    try {
      const res = await session.run({ [inName]: new ort.Tensor("float32", data, dims) });
      out = res[outName];
    } finally {
      sem.release();
      data.fill(0);
    }
    const [batch, dim] = out.dims;
    const mean = new Float32Array(dim);
    for (let k = 0; k < batch; k++) {
      for (let i = 0; i < dim; i++) mean[i] += out.data[k * dim + i];
    }
    out.data.fill(0);
    return l2(mean);
  }

  return { template, modelId, modelIdHex: modelId.toString("hex").slice(0, 16), backend };
}

module.exports = { createModel, cosine };
