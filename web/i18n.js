// Textos de la demo en inglés (por defecto) y español.
// El idioma sale de ?lang=es|en (si viene en la URL), de lo que eligió la persona la última vez,
// o del idioma principal del navegador: español si es español, inglés en cualquier otro caso.
(function () {
  const KEY = "palmyn_demo_lang";
  const DICT = {
    en: {
      "pill.demo": "Public demo",
      "pill.result": "Result",
      "consent.eyebrow": "// Public demo",
      "consent.title": "Palm recognition test",
      "consent.lead": "This demo uses your camera to capture your palm. Before it opens, read and confirm each of these points.",
      "consent.loading": "Loading…",
      "consent.loadError": "Couldn't load the consent text. Please reload the page.",
      "consent.details": "See details →",
      "consent.optional": "(optional)",
      "consent.accept": "Accept and open the camera",
      "consent.legal": 'By continuing you accept the <a href="terms">Terms and conditions</a> and the <a href="privacy">Privacy policy</a>.',
      "cam.flip": "Switch camera",
      "cam.mirror": "Mirror view",
      "cam.opening": "Opening camera…",
      "cam.enroll": "Enroll",
      "cam.verify": "Verify",
      "cam.shots": "{n} / {total} captures",
      "cam.goEnroll": "Enroll my palm",
      "cam.goReenroll": "Enroll again",
      "cam.goVerify": "Verify my palm",
      "cam.token": "🔑 Token <b>{token}…</b> · expires {date}",
      "cam.noToken": "🔑 You don't have a token yet",
      "cam.forget": "Delete token",
      "cam.revoke": "Withdraw my consent and close the camera",
      "hint.loading": "Loading detector…",
      "hint.showPalm": "Show the palm of your left hand",
      "hint.back": "Turn your hand: show the palm of your left hand",
      "hint.side": "Face your palm toward the camera",
      "hint.tooBig": "Move your hand a bit farther away",
      "hint.center": "Center your hand on the screen",
      "hint.hold": "Keep your hand still",
      "hint.ready": "Hand detected · tap the button",
      "cap.noImage": "no image",
      "cap.noHand": "no hand detected",
      "cap.back": "the back of the hand, or the right hand, is showing",
      "cap.side": "the palm is not facing the camera",
      "cap.out": "the palm goes out of the frame",
      "fail.back": "The back of your hand is showing. Show the palm of your left hand.",
      "fail.side": "Your palm isn't facing the camera. Hold your hand flat, facing the camera.",
      "fail.out": "Your palm goes out of the frame. Move it a bit farther away and center it.",
      "fail.generic": "I can't see your palm clearly. Try with more light and your hand open, about 25 cm away.",
      "fail.unstable": "Couldn't get {n} good captures ({err}). Please try again.",
      "res.captures": "Captures",
      "res.time": "Time",
      "res.stored": "Stored",
      "res.analyzing": "Analyzing…",
      "res.enrolledTitle": "Palm enrolled",
      "res.enrolledText": "Your encrypted key is saved in this browser until {date}. Now try verifying.",
      "res.verifyNow": "Verify now",
      "res.back": "Back",
      "res.matchTitle": "It's the same palm",
      "res.matchText": "The verification matches your enrollment. Nothing was stored on the server.",
      "res.verifyAgain": "Verify again",
      "res.otherHand": "Try another hand",
      "res.noMatchTitle": "No match",
      "res.noMatchText": "It doesn't look like the same palm. Try with more light and your hand wide open, or it's a different hand.",
      "res.tryAgain": "Try again",
      "res.reenroll": "Enroll again",
      "res.score": "score ≈ {score} · threshold 0.512 · local only",
      "err.rate_limited": "Too many attempts. Wait a while and try again.",
      "err.region_blocked": "The demo is not available in your region.",
      "err.consent_required": "Your consent is missing: please reload the page.",
      "err.bad_roi": "The capture didn't come out well. Try with more light.",
      "err.generic": "Error {code}",
      "err.tokenExpired": "Your token expired or the model changed. Please enroll again.",
      "err.camera": "Couldn't open the camera: check the browser permission or whether another app is using it.",
      "err.detector": "Couldn't load the hand detector. Please reload the page.",
      "err.flip": "Couldn't switch cameras.",
      "msg.tokenDeleted": "Token deleted from this browser.",
      "gh.title": "Source code on GitHub",
      "lang.switch": "Ver en español",
      "lang.short": "ES",
    },
    es: {
      "pill.demo": "Demo pública",
      "pill.result": "Resultado",
      "consent.eyebrow": "// Demo pública",
      "consent.title": "Prueba de reconocimiento de palma",
      "consent.lead": "Esta demo usa la cámara para capturar tu palma. Antes de abrirla, leé y confirmá cada uno de estos puntos.",
      "consent.loading": "Cargando…",
      "consent.loadError": "No pude cargar el consentimiento. Recargá la página.",
      "consent.details": "Ver el detalle →",
      "consent.optional": "(opcional)",
      "consent.accept": "Aceptar y abrir la cámara",
      "consent.legal": 'Al continuar aceptás los <a href="terminos">Términos y condiciones</a> y la <a href="privacidad">Política de privacidad</a>.',
      "cam.flip": "Cambiar de cámara",
      "cam.mirror": "Vista espejo",
      "cam.opening": "Abriendo cámara…",
      "cam.enroll": "Enrolar",
      "cam.verify": "Verificar",
      "cam.shots": "{n} / {total} capturas",
      "cam.goEnroll": "Enrolar mi palma",
      "cam.goReenroll": "Enrolar de nuevo",
      "cam.goVerify": "Verificar mi palma",
      "cam.token": "🔑 Token <b>{token}…</b> · vence {date}",
      "cam.noToken": "🔑 Todavía no tenés token",
      "cam.forget": "Borrar token",
      "cam.revoke": "Retirar mi consentimiento y cerrar la cámara",
      "hint.loading": "Cargando detector…",
      "hint.showPalm": "Mostrá la palma de tu mano izquierda",
      "hint.back": "Girá la mano: mostrá la palma de la izquierda",
      "hint.side": "Poné la palma de frente a la cámara",
      "hint.tooBig": "Alejá un poco la mano",
      "hint.center": "Centrá la mano en la pantalla",
      "hint.hold": "Mantené la mano quieta",
      "hint.ready": "Mano detectada · tocá el botón",
      "cap.noImage": "sin imagen",
      "cap.noHand": "no se detecta la mano",
      "cap.back": "se ve el dorso de la mano, o la mano derecha",
      "cap.side": "la palma no está de frente",
      "cap.out": "la palma se sale del cuadro",
      "fail.back": "Se ve el dorso de la mano. Mostrá la palma de la mano izquierda.",
      "fail.side": "La palma no está de frente. Poné la mano plana mirando a la cámara.",
      "fail.out": "La palma se sale del cuadro. Alejala un poco y centrala.",
      "fail.generic": "No veo bien la palma. Probá con más luz y la mano abierta, a unos 25 cm.",
      "fail.unstable": "No pude tomar {n} capturas buenas ({err}). Probá de nuevo.",
      "res.captures": "Capturas",
      "res.time": "Tiempo",
      "res.stored": "Guardado",
      "res.analyzing": "Analizando…",
      "res.enrolledTitle": "Palma enrolada",
      "res.enrolledText": "Tu llave cifrada quedó guardada en este navegador hasta el {date}. Ahora probá verificar.",
      "res.verifyNow": "Verificar ahora",
      "res.back": "Volver",
      "res.matchTitle": "Es la misma palma",
      "res.matchText": "La verificación coincide con tu enrolamiento. Nada quedó guardado en el servidor.",
      "res.verifyAgain": "Verificar de nuevo",
      "res.otherHand": "Probar con otra mano",
      "res.noMatchTitle": "No coincide",
      "res.noMatchText": "No parece la misma palma. Probá con más luz y la mano bien abierta, o es otra mano.",
      "res.tryAgain": "Probar de nuevo",
      "res.reenroll": "Volver a enrolar",
      "res.score": "score ≈ {score} · umbral 0.512 · solo local",
      "err.rate_limited": "Hiciste muchos intentos. Esperá un rato y probá de nuevo.",
      "err.region_blocked": "La demo no está disponible en tu región.",
      "err.consent_required": "Falta tu consentimiento: recargá la página.",
      "err.bad_roi": "La captura no salió bien. Probá con más luz.",
      "err.generic": "Error {code}",
      "err.tokenExpired": "Tu token venció o cambió el modelo. Enrolate de nuevo.",
      "err.camera": "No pude abrir la cámara: revisá el permiso del navegador o que no la esté usando otra app.",
      "err.detector": "No pude cargar el detector de manos. Recargá la página.",
      "err.flip": "No pude cambiar de cámara.",
      "msg.tokenDeleted": "Token borrado de este navegador.",
      "gh.title": "Código fuente en GitHub",
      "lang.switch": "View in English",
      "lang.short": "EN",
    },
  };

  const valid = (l) => (l === "es" || l === "en" ? l : null);
  const store = {
    get() { try { return localStorage.getItem(KEY); } catch { return null; } },
    set(l) { try { localStorage.setItem(KEY, l); } catch {} },
  };
  const fromUrl = valid(new URLSearchParams(location.search).get("lang"));
  if (fromUrl) store.set(fromUrl);
  // Si la persona no eligió nada, español solo cuando el idioma principal del navegador es español
  // (es, es-AR, es-419 = Latinoamérica, es-MX, es-ES…). Cualquier otro idioma: inglés.
  const browserLang = () => {
    const first = (navigator.languages && navigator.languages[0]) || navigator.language || "";
    return /^es(-|$)/i.test(first) ? "es" : "en";
  };
  let lang = fromUrl || valid(store.get()) || browserLang();
  const listeners = [];

  function t(key, vars) {
    let s = (DICT[lang] && DICT[lang][key]) ?? DICT.en[key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    return s;
  }
  // Pinta los textos fijos: data-i18n (texto), data-i18n-html (con enlaces), data-i18n-title / -aria.
  function apply(root) {
    root = root || document;
    document.documentElement.lang = lang;
    root.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
    root.querySelectorAll("[data-i18n-html]").forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml)));
    root.querySelectorAll("[data-i18n-title]").forEach((el) => (el.title = t(el.dataset.i18nTitle)));
    root.querySelectorAll("[data-i18n-aria]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
    root.querySelectorAll(".lang").forEach((el) => {
      const other = lang === "en" ? "es" : "en";
      el.title = t("lang.switch"); el.setAttribute("aria-label", t("lang.switch"));
      el.lang = other; el.hreflang = other;
      const s = el.querySelector("span"); if (s) s.textContent = t("lang.short");
    });
  }
  function set(l) {
    if (!valid(l) || l === lang) return;
    lang = l; store.set(l); apply();
    // Si se entró con ?lang=..., se saca de la URL para que recargar no vuelva al idioma anterior.
    const u = new URL(location.href);
    if (u.searchParams.has("lang")) { u.searchParams.delete("lang"); history.replaceState(null, "", u); }
    listeners.forEach((fn) => fn(lang));
  }
  // Botones de idioma: alternan entre inglés y español sin recargar.
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".lang");
    if (b && !b.getAttribute("href")) { e.preventDefault(); set(lang === "en" ? "es" : "en"); }
  });

  window.I18N = {
    get lang() { return lang; },
    t, apply, set,
    onChange: (fn) => listeners.push(fn),
    locale: () => (lang === "es" ? "es-AR" : "en-US"),
  };
  apply();
})();
