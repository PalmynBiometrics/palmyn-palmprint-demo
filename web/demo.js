// Demo pública de Palmyn: consentimiento → cámara → MediaPipe (IMAGE, como la app) → preprocesado
// JS puro (palm_preproc.js, el mismo de la app) → 3 ROIs gris 224 → /v1/enroll y /v1/verify.
// El modelo NO está acá: solo el detector de landmarks de MediaPipe.

const API = "";                         // mismo origen (el backend sirve esta página con SERVE_WEB=1)
const N_FRAMES = 3, GAP_MS = 130, MAX_TRIES = 8;
const STEADY_MS = 500;                  // tiempo con la palma bien ubicada antes de capturar
const WAIT_HAND_MS = 15000;             // cuánto esperamos a que aparezca la palma
const TOKEN_KEY = "palmyn_demo_token";
const DEV = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);   // modo local: score + recortes de la palma
const PP = window.PalmPreproc;
const { t } = window.I18N;

const $ = (id) => document.getElementById(id);
const video = $("video"), overlay = $("overlay"), octx = overlay.getContext("2d");
let consentVersion = null, videoLm = null, imageLm = null;
let accepted = false, camOn = false, busy = false, looping = false, mode = "enroll";
let cams = [], camIdx = -1;
const live = { hand: false, inBounds: false, tooBig: false, facing: "none", okSince: 0 };
let errUntil = 0;
let consentData = null, lastResult = null, shotsN = 0;
let camFacingMode = "unknown";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
const fmtDate = (iso) => new Date(iso).toLocaleDateString(I18N.locale(), { day: "2-digit", month: "2-digit", year: "numeric" });

// ── pantallas ────────────────────────────────────────────────────────────────
function show(id) { for (const s of ["scrConsent", "scrCam", "scrResult"]) $(s).hidden = s !== id; }

// ── toast (avisos en vivo y errores) ─────────────────────────────────────────
function toast(msg, kind = "") {
  const t = $("toast");
  t.textContent = msg; t.className = "toast" + (kind ? " " + kind : "");
}
function toastError(msg, ms = 4500) { errUntil = performance.now() + ms; toast(msg, "err"); }

// ── token en el navegador ────────────────────────────────────────────────────
function getToken() { try { return JSON.parse(localStorage.getItem(TOKEN_KEY)); } catch { return null; } }
function setToken(t) {
  try { t ? localStorage.setItem(TOKEN_KEY, JSON.stringify(t)) : localStorage.removeItem(TOKEN_KEY); } catch {}
  if (!t && mode === "verify") setMode("enroll");
  refresh();
}

// ── estado de la UI ──────────────────────────────────────────────────────────
function setMode(m) { mode = m; refresh(); }
function setShots(n) {
  $("shots").querySelectorAll("i").forEach((d, i) => d.classList.toggle("on", i < n));
  shotsN = n;
  $("shotsTxt").innerHTML = "&nbsp;" + esc(t("cam.shots", { n, total: N_FRAMES }));
}
function refresh() {
  // consentimiento
  const boxes = [...document.querySelectorAll("#consentItems input")];
  const done = boxes.filter((b) => b.checked).length;
  $("meter").innerHTML = boxes.map((_, i) => `<i class="${i < done ? "on" : ""}"></i>`).join("");
  $("btnAccept").disabled = !consentVersion || !boxes.length || done !== boxes.length;
  // cámara
  const tk = getToken();
  $("modeEnroll").classList.toggle("on", mode === "enroll");
  $("modeVerify").classList.toggle("on", mode === "verify");
  $("modeVerify").disabled = !tk || busy;
  $("modeEnroll").disabled = busy;
  $("btnGo").disabled = !(imageLm && camOn && accepted) || busy;
  if (!busy) $("btnGo").textContent = mode === "enroll" ? t(tk ? "cam.goReenroll" : "cam.goEnroll") : t("cam.goVerify");
  $("tokTxt").innerHTML = tk ? t("cam.token", { token: esc(tk.token.slice(0, 14)), date: fmtDate(tk.expires_at) }) : t("cam.noToken");
  $("btnForget").hidden = !tk || busy;
}

// ── API ──────────────────────────────────────────────────────────────────────
async function api(path, body) {
  const r = await fetch(API + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  let j = null;
  try { j = await r.json(); } catch {}
  return j || { code: r.status, result: { error: "http_" + r.status } };
}
const acceptedItems = () => [...document.querySelectorAll("#consentItems input:checked")].map((b) => b.value);
const consentBody = () => ({ version: consentVersion, accepted, items: acceptedItems() });

// ── cámara ───────────────────────────────────────────────────────────────────
// La guía se espeja junto con la vista, así coincide con lo que la persona ve. El chequeo palma/dorso
// usa los frames crudos (sin espejo), por eso no depende de esto.
function setMirror(on) { [video, overlay, $("guide")].forEach((el) => el.classList.toggle("mirror", on)); }
async function startCam(deviceId) {
  stopCam();
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } }), width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await new Promise((r) => (video.onloadedmetadata = r));
  await video.play();
  overlay.width = video.videoWidth; overlay.height = video.videoHeight;
  // cámara trasera = sin espejo; frontal o webcam = espejo (más natural para la persona)
  const camFacing = stream.getVideoTracks()[0]?.getSettings?.().facingMode;
  camFacingMode = camFacing === "user" || camFacing === "environment" ? camFacing : "unknown";
  setMirror(camFacing !== "environment");
  camOn = true;
  try {
    cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    const cur = stream.getVideoTracks()[0]?.getSettings?.().deviceId;
    camIdx = Math.max(0, cams.findIndex((c) => c.deviceId === cur));
  } catch {}
  $("btnFlip").hidden = cams.length < 2;
}
function stopCam() {
  if (video.srcObject) video.srcObject.getTracks().forEach((t) => t.stop());
  video.srcObject = null; camOn = false;
}

// ── MediaPipe (mismos assets que la app) ─────────────────────────────────────
async function loadLandmarkers() {
  const { HandLandmarker } = await import("./vendor/vision_bundle.mjs");
  const fileset = { wasmLoaderPath: "vendor/vision_wasm_internal.js", wasmBinaryPath: "vendor/vision_wasm_internal.wasm" };
  const task = new Uint8Array(await (await fetch("vendor/hand_landmarker.task")).arrayBuffer());
  const common = { numHands: 1, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5 };
  videoLm = await HandLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetBuffer: task.slice() }, runningMode: "VIDEO", minTrackingConfidence: 0.5, ...common });
  imageLm = await HandLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetBuffer: task.slice() }, runningMode: "IMAGE", ...common });
}

const geom = (px) => PP.computeRoiGeometry(px, PP.CFG.roiScaleK, PP.CFG.roiCenterOffset);
function roiCorners(px) {
  const g = geom(px), h = g.side / 2;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => [g.cx + sx * h * g.ux + sy * h * g.fx, g.cy + sx * h * g.uy + sy * h * g.fy]);
}
function roiInBounds(px, W, H) {        // igual que _roiInBounds de la app
  const tol = 0.08 * geom(px).side;
  return roiCorners(px).every(([x, y]) => x >= -tol && x <= W + tol && y >= -tol && y <= H + tol);
}
// Conexiones del esqueleto de MediaPipe (21 puntos)
const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
// Pose de referencia para la guía: palma IZQUIERDA vista por la cámara, dedos a la derecha => pulgar ARRIBA
// (así salen las fotos reales de data_raw). Se arma espejando en Y la pose base.
const GUIDE_PTS = [[44,106],[70,140],[104,166],[132,182],[156,190],[150,138],[184,141],[214,144],[246,146],
  [156,112],[192,111],[228,110],[264,110],[154,86],[186,83],[218,79],[250,76],[146,62],[170,57],[192,52],[214,48]]
  .map(([x, y]) => [x, 236 - y]);

// ── ¿palma o dorso? ──────────────────────────────────────────────────────────
// Orientación de la mano: signo del producto vectorial (índice−muñeca) × (meñique−muñeca), normalizado.
// Palma izquierda a la cámara => positivo. Dorso de la izquierda o palma de la derecha => la mano se ve
// espejada y el signo se invierte. Medido en 120 fotos reales de data_raw: palmas 118/119 en [0.47, 0.89]
// (la restante era un error de landmarks); espejadas 119/119 en [-0.75, -0.37].
// Límite: el DORSO de la mano DERECHA se ve igual que la palma izquierda (misma geometría) y pasa este filtro.
const FACING_MIN = 0.25;
function facing(px) {
  const [wx, wy] = px[0], [ix, iy] = px[5], [qx, qy] = px[17];
  const ax = ix - wx, ay = iy - wy, bx = qx - wx, by = qy - wy;
  const c = (ax * by - ay * bx) / ((Math.hypot(ax, ay) * Math.hypot(bx, by)) || 1);
  return c >= FACING_MIN ? "palm" : c <= -FACING_MIN ? "back" : "side";
}
function renderGuide() {
  $("guide").innerHTML =
    BONES.map(([a, b]) => `<line x1="${GUIDE_PTS[a][0]}" y1="${GUIDE_PTS[a][1]}" x2="${GUIDE_PTS[b][0]}" y2="${GUIDE_PTS[b][1]}"/>`).join("") +
    GUIDE_PTS.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i === 0 ? 5 : 4}" style="animation-delay:${(i * 0.08).toFixed(2)}s"/>`).join("");
}
// Esqueleto real de la mano detectada (mismo estilo que la guía)
function drawSkeleton(px) {
  const u = overlay.width / 400;
  octx.strokeStyle = "rgba(77,143,255,.7)"; octx.lineWidth = Math.max(2, 1.6 * u);
  octx.beginPath();
  for (const [a, b] of BONES) { octx.moveTo(px[a][0], px[a][1]); octx.lineTo(px[b][0], px[b][1]); }
  octx.stroke();
  octx.fillStyle = "#00E5B0";
  for (const [x, y] of px) { octx.beginPath(); octx.arc(x, y, Math.max(3, 3.5 * u), 0, 7); octx.fill(); }
}

const toPx = (lm, W, H) => lm.slice(0, 21).map((p) => [p.x * W, p.y * H]);

// esquinas tipo visor sobre el cuadrado de la ROI
function drawBrackets(c, color) {
  const L = 0.22;
  octx.strokeStyle = color; octx.lineWidth = Math.max(4, overlay.width / 220); octx.lineCap = "round"; octx.lineJoin = "round";
  for (let i = 0; i < 4; i++) {
    const p = c[i], a = c[(i + 3) % 4], b = c[(i + 1) % 4];
    octx.beginPath();
    octx.moveTo(p[0] + (a[0] - p[0]) * L, p[1] + (a[1] - p[1]) * L);
    octx.lineTo(p[0], p[1]);
    octx.lineTo(p[0] + (b[0] - p[0]) * L, p[1] + (b[1] - p[1]) * L);
    octx.stroke();
  }
}

// loop en vivo: detecta, dibuja el visor y actualiza los avisos
let lastT = -1;
function loop() {
  if (videoLm && camOn && video.readyState >= 2 && !$("scrCam").hidden) {
    const now = performance.now();
    if (now !== lastT) {
      lastT = now;
      const W = video.videoWidth, H = video.videoHeight;
      octx.clearRect(0, 0, W, H);
      const lm = videoLm.detectForVideo(video, now).landmarks?.[0];
      live.hand = !!lm;
      if (lm) {
        const px = toPx(lm, W, H);
        live.inBounds = roiInBounds(px, W, H);
        live.facing = facing(px);
        live.tooBig = geom(px).side > 0.95 * Math.min(W, H);
        drawSkeleton(px);
        drawBrackets(roiCorners(px), live.facing === "back" ? "#FF6B6B" : live.inBounds && live.facing === "palm" ? "#00E5B0" : "#FFB454");
      } else { live.inBounds = false; live.facing = "none"; }
      if (live.hand && live.inBounds && live.facing === "palm") { if (!live.okSince) live.okSince = now; } else live.okSince = 0;
      $("guide").style.opacity = live.hand ? 0 : 1;
      if (now > errUntil) hint();
    }
  }
  requestAnimationFrame(loop);
}
function hint() {
  if (!imageLm) return toast(t("hint.loading"));
  if (!live.hand) return toast(t("hint.showPalm"));
  if (live.facing === "back") return toast(t("hint.back"), "err");
  if (live.facing === "side") return toast(t("hint.side"), "warn");
  if (!live.inBounds) return toast(t(live.tooBig ? "hint.tooBig" : "hint.center"), "warn");
  toast(t(busy ? "hint.hold" : "hint.ready"), "ok");
}

// ── captura: igual que _captureOne de la app, pero manda la ROI gris (no el embedding) ──
function b64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function captureOne() {
  const W = video.videoWidth, H = video.videoHeight;
  if (!W) return { error: t("cap.noImage") };
  const cap = document.createElement("canvas"); cap.width = W; cap.height = H;
  const cctx = cap.getContext("2d", { willReadFrequently: true }); cctx.drawImage(video, 0, 0, W, H);
  const lm = imageLm.detect(cap).landmarks?.[0];
  if (!lm) return { error: t("cap.noHand") };
  const px = toPx(lm, W, H);
  const f = facing(px);
  if (f !== "palm") return { error: t(f === "back" ? "cap.back" : "cap.side") };
  if (!roiInBounds(px, W, H)) return { error: t("cap.out") };
  return { roi: PP.preprocessGray(cctx.getImageData(0, 0, W, H).data, W, H, 4, px) };
}
function drawRois(rois) {
  const box = $("rois"); box.innerHTML = ""; box.hidden = !DEV;
  if (!DEV) return;
  for (const roi of rois) {
    const c = document.createElement("canvas"); c.width = c.height = 224;
    const id = c.getContext("2d").createImageData(224, 224);
    for (let i = 0; i < roi.length; i++) { id.data[4 * i] = id.data[4 * i + 1] = id.data[4 * i + 2] = roi[i]; id.data[4 * i + 3] = 255; }
    c.getContext("2d").putImageData(id, 0, 0); box.appendChild(c);
  }
}
// Error de captura con el motivo para las estadísticas (no_hand | back | side | out_of_frame | unstable)
class CaptureError extends Error { constructor(msg, reason) { super(msg); this.reason = reason; } }

async function waitSteady() {
  const t0 = performance.now();
  const seen = { no_hand: 0, back: 0, side: 0, out_of_frame: 0 };   // qué pasó mientras esperábamos
  while (!(live.okSince && performance.now() - live.okSince >= STEADY_MS)) {
    if (!live.hand) seen.no_hand++;
    else if (live.facing === "back") seen.back++;
    else if (live.facing === "side") seen.side++;
    else if (!live.inBounds) seen.out_of_frame++;
    if (performance.now() - t0 > WAIT_HAND_MS) {
      const reason = Object.entries(seen).sort((a, b) => b[1] - a[1])[0][0];
      const msg = t({ back: "fail.back", side: "fail.side", out_of_frame: "fail.out" }[reason] || "fail.generic");
      throw new CaptureError(msg, reason);
    }
    await sleep(60);
  }
}
async function captureN() {
  await waitSteady();
  const rois = []; let tries = 0, lastErr = "";
  while (rois.length < N_FRAMES && tries < MAX_TRIES) {
    tries++;
    const r = captureOne();
    if (r.roi) { rois.push(r.roi); setShots(rois.length); } else lastErr = r.error;
    await sleep(GAP_MS);
  }
  if (rois.length < N_FRAMES) throw new CaptureError(t("fail.unstable", { n: N_FRAMES, err: lastErr }), "unstable");
  drawRois(rois);
  return rois;
}

// ── estadísticas anónimas (solo si la casilla está tildada) ──────────────────
// Solo categorías: sistema, tipo de dispositivo, cámara y resolución. Nada que identifique a la persona.
const shareStats = () => $("stats").checked;
function clientInfo() {
  const ua = navigator.userAgent || "";
  const uad = navigator.userAgentData;
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const os = /Android/i.test(ua) ? "android" : /iPhone|iPad|iPod/.test(ua) || iPadOS ? "ios"
    : /CrOS/.test(ua) ? "chromeos" : /Windows/.test(ua) ? "windows" : /Mac OS X|Macintosh/.test(ua) ? "macos"
    : /Linux/.test(ua) ? "linux" : "other";
  const device = /iPad/.test(ua) || iPadOS || (/Android/i.test(ua) && !/Mobile/i.test(ua)) ? "tablet"
    : (uad && uad.mobile) || /Mobi|iPhone/i.test(ua) ? "mobile" : "desktop";
  return { os, device, camera: camFacingMode, resolution: video.videoWidth ? `${video.videoWidth}x${video.videoHeight}` : null };
}
function reportCaptureFail(reason) {
  if (!shareStats() || !accepted) return;
  fetch(API + "/v1/stats/capture-fail", {
    method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
    body: JSON.stringify({ consent: consentBody(), share_stats: true, reason, mode, client: clientInfo() }),
  }).catch(() => {});
}

// ── resultado ────────────────────────────────────────────────────────────────
let resActions = {};
function showResult(r) {
  lastResult = r;
  const { ok, ms, score, main, sec } = r;
  const title = t(r.title), text = t(r.text, r.vars);
  $("resRing").classList.toggle("bad", !ok);
  $("resIcon").textContent = ok ? "✓" : "✕";
  $("resGlow").className = "glow " + (ok ? "teal" : "red");
  $("resTitle").textContent = title;
  $("resText").textContent = text;
  const secs = (ms / 1000).toFixed(1);
  $("resTime").textContent = (I18N.lang === "es" ? secs.replace(".", ",") : secs) + " s";
  $("resScore").hidden = !(DEV && score !== undefined);
  if (DEV && score !== undefined) $("resScore").textContent = t("res.score", { score });
  $("resMain").textContent = t(main[0]); $("resSec").textContent = t(sec[0]);
  resActions = { main: main[1], sec: sec[1] };
  show("scrResult");
}
function backToCam(m) { setMode(m); setShots(0); show("scrCam"); }

const KNOWN_ERRORS = ["rate_limited", "region_blocked", "consent_required", "bad_roi"];
const errText = (j) => KNOWN_ERRORS.includes(j.result?.error) ? t("err." + j.result.error)
  : t("err.generic", { code: j.code }) + (j.result?.message ? ": " + j.result.message : "");

async function run() {
  busy = true; setShots(0); refresh();
  $("scan").hidden = false;
  try {
    const rois = await captureN();
    toast(t("res.analyzing"), "ok");
    const t0 = performance.now();
    if (mode === "enroll") {
      const j = await api("/v1/enroll", { consent: consentBody(), rois: rois.map(b64) });
      if (j.code !== 200) return toastError(errText(j));
      setToken(j.result);
      showResult({
        ok: true, title: "res.enrolledTitle", ms: performance.now() - t0,
        text: "res.enrolledText", vars: { date: fmtDate(j.result.expires_at) },
        main: ["res.verifyNow", () => backToCam("verify")], sec: ["res.back", () => backToCam("enroll")],
      });
    } else {
      const j = await api("/v1/verify", {
        consent: consentBody(), token: getToken().token, rois: rois.map(b64),
        ...(shareStats() ? { share_stats: true, client: clientInfo() } : {}),
      });
      if (j.code === 409) { setToken(null); return toastError(t("err.tokenExpired")); }
      if (j.code !== 200) return toastError(errText(j));
      const m = j.result.match;
      showResult(m
        ? { ok: true, title: "res.matchTitle", ms: performance.now() - t0, score: j.result.score, text: "res.matchText",
            main: ["res.verifyAgain", () => backToCam("verify")], sec: ["res.otherHand", () => backToCam("verify")] }
        : { ok: false, title: "res.noMatchTitle", ms: performance.now() - t0, score: j.result.score, text: "res.noMatchText",
            main: ["res.tryAgain", () => backToCam("verify")], sec: ["res.reenroll", () => backToCam("enroll")] });
    }
  } catch (e) {
    if (e instanceof CaptureError) reportCaptureFail(e.reason);
    toastError(e.message || String(e));
  } finally {
    busy = false; $("scan").hidden = true; refresh();
  }
}

// ── consentimiento: una casilla por declaración, todas sin marcar ─────────────
function renderConsent(c) {
  consentData = c;
  const L = c.items[I18N.lang] ? I18N.lang : "en";
  const checked = new Set(acceptedItems());
  $("consentItems").innerHTML = c.items[L].map((it) => `
    <label class="item"><input type="checkbox" value="${esc(it.id)}"${checked.has(it.id) ? " checked" : ""}><span class="box">✓</span>
      <div><b>${esc(it.title)}</b>
        ${it.summary ? `<small>${esc(it.summary)}</small>` : ""}
        ${it.detail ? `<details class="more"><summary>${esc(t("consent.details"))}</summary><ul>${it.detail.map((d) => `<li>${esc(d)}</li>`).join("")}</ul></details>` : ""}
      </div></label>`).join("");
  // abrir "Ver el detalle" no tiene que marcar la casilla
  $("consentItems").querySelectorAll("details").forEach((d) => d.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation(); if (e.target.closest("summary")) d.open = !d.open;
  }));
  const opt = c.optional?.[L];
  if (opt) {
    $("optTitle").innerHTML = `${esc(opt.title)} <i>${esc(t("consent.optional"))}</i>`;
    $("optRow").hidden = false;
  }
}

// ── init ─────────────────────────────────────────────────────────────────────
// El detector de manos se precarga mientras la persona lee (no toca la cámara ni datos).
const detectorReady = loadLandmarkers();
detectorReady.catch(() => { imageLm = null; });

async function openCamera() {
  accepted = true;
  show("scrCam"); refresh();
  try {
    toast(t("cam.opening"));
    await startCam();
  } catch (e) {
    return toastError(t("err.camera"), 1e9);
  }
  try { await detectorReady; } catch (e) { return toastError(t("err.detector"), 1e9); }
  if (getToken()) setMode("verify");
  if (!looping) { looping = true; requestAnimationFrame(loop); }
  refresh();
}

$("consentItems").addEventListener("change", refresh);
$("btnAccept").onclick = openCamera;
$("btnRevoke").onclick = () => {
  stopCam(); accepted = false;
  document.querySelectorAll("#consentItems input, #stats").forEach((b) => (b.checked = false));
  $("rois").innerHTML = ""; setShots(0);
  show("scrConsent"); refresh();
};
$("modeEnroll").onclick = () => setMode("enroll");
$("modeVerify").onclick = () => setMode("verify");
$("btnGo").onclick = run;
$("btnForget").onclick = () => { setToken(null); toastError(t("msg.tokenDeleted"), 2500); };
$("btnMirror").onclick = () => setMirror(!video.classList.contains("mirror"));
$("btnFlip").onclick = async () => {
  if (cams.length < 2) return;
  camIdx = (camIdx + 1) % cams.length;
  try { await startCam(cams[camIdx].deviceId); } catch (e) { toastError(t("err.flip")); }
  refresh();
};
$("resMain").onclick = () => resActions.main?.();
$("resSec").onclick = () => resActions.sec?.();

(async () => {
  if (DEV) { $("envPill").removeAttribute("data-i18n"); $("envPill").textContent = "Local"; $("envPill").classList.add("dev"); }
  show("scrConsent");
  renderGuide();
  setShots(0);
  try {
    const c = await api("/v1/consent");
    consentVersion = c.result.version;
    renderConsent(c.result);
  } catch { $("consentItems").innerHTML = `<p class="lead">${esc(t("consent.loadError"))}</p>`; }
  refresh();
})();

// Cambio de idioma en vivo: re-pinta el consentimiento (sin perder lo tildado), los botones y el resultado.
I18N.onChange(() => {
  if (consentData) renderConsent(consentData);
  setShots(shotsN);
  refresh();
  if (lastResult && !$("scrResult").hidden) showResult(lastResult);
  if (performance.now() > errUntil && !$("scrCam").hidden) hint();
});
