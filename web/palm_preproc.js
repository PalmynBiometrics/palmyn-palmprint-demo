// palm_preproc_purejs.js — Preprocesado palmprint en JS PURO (sin opencv).
// Replica palmproc_v2: geometría Zhang -> warp afín bilineal/replicate dedos-arriba
// 224 -> gris (luma fixed-point OpenCV) -> mediana 3x3 -> CLAHE(2.0, 8x8) ->
// gris→3ch + ImageNet -> Float32Array(1,3,224,224).
//
// Objetivo: reemplazar opencv.js (10MB WASM) en el WebView. Se valida en Node
// contra la referencia Python (parity_out/reference.json) → cosine.
//
// API:
//   preprocess(src, w, h, channels, lmPx, cfg?) -> Float32Array(3*out*out)
//   preprocessGray(src, w, h, channels, lmPx, cfg?) -> Uint8Array(out*out)  (debug/preview)
//   src: Uint8Array/Buffer. channels=3 (BGR) ó 4 (RGBA). lmPx: 21 pares [x,y] px.

const CFG = {
  roiScaleK: 1.30,
  roiCenterOffset: 0.55,
  outSize: 224,
  medianK: 3,
  claheClip: 2.0,
  claheTile: 8,
  imagenetMean: [0.485, 0.456, 0.406],
  imagenetStd: [0.229, 0.224, 0.225],
};

function unit(vx, vy) {
  const n = Math.hypot(vx, vy) || 1e-8;
  return [vx / n, vy / n];
}

// Espejo de compute_roi_geometry (anchor_method="mcp").
function computeRoiGeometry(lm, k, offset) {
  const [ix, iy] = lm[5];   // INDEX_MCP
  const [px, py] = lm[17];  // PINKY_MCP
  const [wx, wy] = lm[0];   // WRIST
  const [ux, uy] = unit(ix - px, iy - py);
  const palmWidth = Math.hypot(ix - px, iy - py);
  const mx = (ix + px) / 2, my = (iy + py) / 2;
  let perpx = -uy, perpy = ux;
  if (perpx * (wx - mx) + perpy * (wy - my) > 0) { perpx = -perpx; perpy = -perpy; }
  const [fx, fy] = unit(perpx, perpy);
  const side = k * palmWidth;
  const cx = mx - fx * (offset * palmWidth);
  const cy = my - fy * (offset * palmWidth);
  return { cx, cy, ux, uy, fx, fy, side };
}

// ── Gris (luma) byte-exacto OpenCV: Y=(R*4899+G*9617+B*1868+8192)>>14 ───────────
function toGray(src, w, h, channels) {
  const N = w * h;
  const gray = new Uint8Array(N);
  if (channels === 4) {            // RGBA (canvas)
    for (let i = 0, p = 0; i < N; i++, p += 4) {
      gray[i] = (src[p] * 4899 + src[p + 1] * 9617 + src[p + 2] * 1868 + 8192) >> 14;
    }
  } else {                         // BGR (cv CV_8UC3)
    for (let i = 0, p = 0; i < N; i++, p += 3) {
      gray[i] = (src[p + 2] * 4899 + src[p + 1] * 9617 + src[p] * 1868 + 8192) >> 14;
    }
  }
  return gray;
}

// ── getAffineTransform: resuelve M(2x3) tal que dst = M·[src;1] (3 pares) ────────
function solve3(a, b) { // a: 3x3, b: 3 -> x: 3   (eliminación gaussiana)
  const m = [a[0].slice(), a[1].slice(), a[2].slice()];
  const y = b.slice();
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    [m[col], m[piv]] = [m[piv], m[col]];
    [y[col], y[piv]] = [y[piv], y[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c < 3; c++) m[r][c] -= f * m[col][c];
      y[r] -= f * y[col];
    }
  }
  return [y[0] / m[0][0], y[1] / m[1][1], y[2] / m[2][2]];
}

function getAffineTransform(srcPts, dstPts) {
  // filas: [sx, sy, 1]
  const A = [
    [srcPts[0][0], srcPts[0][1], 1],
    [srcPts[1][0], srcPts[1][1], 1],
    [srcPts[2][0], srcPts[2][1], 1],
  ];
  const row0 = solve3(A, [dstPts[0][0], dstPts[1][0], dstPts[2][0]]); // -> dst.x
  const row1 = solve3(A, [dstPts[0][1], dstPts[1][1], dstPts[2][1]]); // -> dst.y
  return [row0[0], row0[1], row0[2], row1[0], row1[1], row1[2]]; // [a,b,c,d,e,f]
}

function invertAffine(M) {
  const [a, b, c, d, e, f] = M;
  const det = a * e - b * d;
  const ia = e / det, ib = -b / det, id = -d / det, ie = a / det;
  const ic = -(ia * c + ib * f), iff = -(id * c + ie * f);
  return [ia, ib, ic, id, ie, iff];
}

// ── warpAffine bilineal + BORDER_REPLICATE (gris) ───────────────────────────────
// out(dx,dy) -> src(sx,sy) vía M_inv -> muestreo bilineal con clamp a bordes.
function warpAffineGray(gray, w, h, M, out) {
  const inv = invertAffine(M);
  const [ia, ib, ic, id, ie, iff] = inv;
  const dst = new Uint8Array(out * out);
  for (let dy = 0; dy < out; dy++) {
    for (let dx = 0; dx < out; dx++) {
      const sx = ia * dx + ib * dy + ic;
      const sy = id * dx + ie * dy + iff;
      // BORDER_REPLICATE
      let x0 = Math.floor(sx), y0 = Math.floor(sy);
      const fx = sx - x0, fy = sy - y0;
      let x1 = x0 + 1, y1 = y0 + 1;
      if (x0 < 0) x0 = 0; else if (x0 > w - 1) x0 = w - 1;
      if (x1 < 0) x1 = 0; else if (x1 > w - 1) x1 = w - 1;
      if (y0 < 0) y0 = 0; else if (y0 > h - 1) y0 = h - 1;
      if (y1 < 0) y1 = 0; else if (y1 > h - 1) y1 = h - 1;
      const p00 = gray[y0 * w + x0], p01 = gray[y0 * w + x1];
      const p10 = gray[y1 * w + x0], p11 = gray[y1 * w + x1];
      const top = p00 + (p01 - p00) * fx;
      const bot = p10 + (p11 - p10) * fx;
      dst[dy * out + dx] = (top + (bot - top) * fy + 0.5) | 0;
    }
  }
  return dst;
}

// ── medianBlur 3x3, BORDER_REPLICATE ────────────────────────────────────────────
function medianBlur3(img, w, h) {
  const dst = new Uint8Array(w * h);
  const win = new Uint8Array(9);
  const cl = (v, max) => (v < 0 ? 0 : v > max ? max : v);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = cl(y + dy, h - 1);
        for (let dx = -1; dx <= 1; dx++) {
          win[k++] = img[yy * w + cl(x + dx, w - 1)];
        }
      }
      // insertion sort de 9 + mediana (win[4])
      for (let i = 1; i < 9; i++) {
        const v = win[i]; let j = i - 1;
        while (j >= 0 && win[j] > v) { win[j + 1] = win[j]; j--; }
        win[j + 1] = v;
      }
      dst[y * w + x] = win[4];
    }
  }
  return dst;
}

// ── CLAHE (replica imgproc/src/clahe.cpp) ───────────────────────────────────────
function clahe(img, w, h, clipLimit, tiles) {
  const tilesX = tiles, tilesY = tiles;
  const twF = w / tilesX, thF = h / tilesY;     // tamaño de tile (puede no ser entero)
  const tileArea = twF * thF;
  const histSize = 256;
  const lutScale = (histSize - 1) / tileArea;
  let clipLimitInt = Math.max(Math.floor(clipLimit * tileArea / histSize), 1);

  // LUT por tile: tilesY x tilesX x 256
  const luts = new Uint8Array(tilesY * tilesX * histSize);
  const hist = new Int32Array(histSize);

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      hist.fill(0);
      const x0 = Math.round(tx * twF), x1 = Math.round((tx + 1) * twF);
      const y0 = Math.round(ty * thF), y1 = Math.round((ty + 1) * thF);
      for (let y = y0; y < y1; y++) {
        const row = y * w;
        for (let x = x0; x < x1; x++) hist[img[row + x]]++;
      }
      // clip + redistribución
      let clipped = 0;
      for (let i = 0; i < histSize; i++) {
        if (hist[i] > clipLimitInt) { clipped += hist[i] - clipLimitInt; hist[i] = clipLimitInt; }
      }
      const redistBatch = (clipped / histSize) | 0;
      let residual = clipped - redistBatch * histSize;
      for (let i = 0; i < histSize; i++) hist[i] += redistBatch;
      if (residual !== 0) {
        const step = Math.max((histSize / residual) | 0, 1);
        for (let i = 0; i < histSize && residual > 0; i += step, residual--) hist[i]++;
      }
      // CDF -> LUT
      const base = (ty * tilesX + tx) * histSize;
      let sum = 0;
      for (let i = 0; i < histSize; i++) {
        sum += hist[i];
        let v = Math.round(sum * lutScale);
        luts[base + i] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }

  // interpolación bilineal de las LUTs de tiles (CLAHE_Interpolation_Body)
  const dst = new Uint8Array(w * h);
  const tw = w / tilesX, th = h / tilesY;
  for (let y = 0; y < h; y++) {
    let tyf = y / th - 0.5;
    let ty1 = Math.floor(tyf);
    const ya = tyf - ty1;
    let ty2 = ty1 + 1;
    if (ty1 < 0) ty1 = 0; if (ty2 > tilesY - 1) ty2 = tilesY - 1; if (ty1 > tilesY - 1) ty1 = tilesY - 1;
    for (let x = 0; x < w; x++) {
      let txf = x / tw - 0.5;
      let tx1 = Math.floor(txf);
      const xa = txf - tx1;
      let tx2 = tx1 + 1;
      if (tx1 < 0) tx1 = 0; if (tx2 > tilesX - 1) tx2 = tilesX - 1; if (tx1 > tilesX - 1) tx1 = tilesX - 1;
      const v = img[y * w + x];
      const l00 = luts[(ty1 * tilesX + tx1) * histSize + v];
      const l01 = luts[(ty1 * tilesX + tx2) * histSize + v];
      const l10 = luts[(ty2 * tilesX + tx1) * histSize + v];
      const l11 = luts[(ty2 * tilesX + tx2) * histSize + v];
      const top = l00 * (1 - xa) + l01 * xa;
      const bot = l10 * (1 - xa) + l11 * xa;
      let r = top * (1 - ya) + bot * ya;
      dst[y * w + x] = (r + 0.5) | 0;
    }
  }
  return dst;
}

// ── pipeline → gris 224 (debug/preview) ─────────────────────────────────────────
function preprocessGray(src, w, h, channels, lm, cfg = {}) {
  const c = { ...CFG, ...cfg };
  const out = c.outSize;
  const g = computeRoiGeometry(lm, c.roiScaleK, c.roiCenterOffset);
  const half = g.side / 2, cc = out / 2;
  const srcPts = [
    [g.cx, g.cy],
    [g.cx + g.ux * half, g.cy + g.uy * half],
    [g.cx + g.fx * half, g.cy + g.fy * half],
  ];
  const dstPts = [[cc, cc], [out, cc], [cc, 0]];
  const M = getAffineTransform(srcPts, dstPts);

  const graySrc = toGray(src, w, h, channels);
  let roi = warpAffineGray(graySrc, w, h, M, out);
  if (c.medianK >= 3) roi = medianBlur3(roi, out, out);
  roi = clahe(roi, out, out, c.claheClip, c.claheTile);
  return roi;
}

// ── pipeline completo → tensor ──────────────────────────────────────────────────
function preprocess(src, w, h, channels, lm, cfg = {}) {
  const c = { ...CFG, ...cfg };
  const out = c.outSize;
  const roi = preprocessGray(src, w, h, channels, lm, c);
  const N = out * out;
  const t = new Float32Array(3 * N);
  const m = c.imagenetMean, s = c.imagenetStd;
  for (let i = 0; i < N; i++) {
    const v = roi[i] / 255;
    t[i] = (v - m[0]) / s[0];
    t[N + i] = (v - m[1]) / s[1];
    t[2 * N + i] = (v - m[2]) / s[2];
  }
  return t;
}

window.PalmPreproc = {
  preprocess, preprocessGray, computeRoiGeometry, getAffineTransform,
  toGray, warpAffineGray, medianBlur3, clahe, CFG,
};
