// Consentimiento versionado. El front lo pide a GET /v1/consent y muestra una casilla por cada
// declaración obligatoria (items). En cada request manda la versión y la lista de ids aceptados:
// el servidor exige que estén TODOS. Si cambiás cualquier texto, subí la versión.
// BORRADOR: revisarlo con un abogado antes de abrir la demo.
const CONSENT = {
  version: "2026-11-demo-4",
  items: {
    es: [
      {
        id: "processing",
        title: "Entiendo qué pasa con mi palma",
        summary: "Se envía solo un recorte en gris a un servidor en Brasil. El servidor lo procesa, me devuelve una llave cifrada y lo borra al instante.",
        detail: [
          "Para probar Palmyn, tu celular recorta la palma de tu mano y envía ese recorte (una imagen de 224×224 en gris) a nuestro servidor.",
          "El servidor calcula una plantilla biométrica, te la devuelve cifrada para que la guardes en tu dispositivo y borra el recorte y la plantilla en el momento. No guardamos imágenes ni datos biométricos.",
          "Solo vos tenés la plantilla cifrada; si la borrás, la prueba se pierde. Podés dejar de usar la demo cuando quieras.",
          "La demo funciona en servidores de Hostinger ubicados en Brasil, fuera de Argentina, y las copias de seguridad del servidor (que pueden incluir las estadísticas anónimas opcionales, nunca imágenes ni plantillas) se guardan en Estados Unidos. Al marcar esta casilla acepto esa transferencia internacional de datos.",
        ],
      },
      { id: "age_own_hand", title: "Soy mayor de 18 años y la mano es mía" },
      {
        id: "residency",
        title: "No resido en Illinois, Texas ni Washington (EE.UU.)",
        summary: "Por ahora la demo no está disponible en esos estados.",
      },
    ],
    en: [
      {
        id: "processing",
        title: "I understand what happens to my palm",
        summary: "Only a grayscale crop is sent to a server in Brazil. The server processes it, returns an encrypted key to me and deletes it immediately.",
        detail: [
          "To try Palmyn, your phone crops the palm of your hand and sends that crop (a 224×224 grayscale image) to our server.",
          "The server computes a biometric template, returns it to you encrypted so you keep it on your device, and immediately deletes the crop and the template. We do not store images or biometric data.",
          "Only you hold the encrypted template; if you delete it, the test is lost. You can stop using the demo at any time.",
          "The demo runs on Hostinger servers located in Brazil, outside Argentina, and server backups (which may include the optional anonymous statistics, never images or templates) are stored in the United States. By checking this box I accept this international data transfer.",
        ],
      },
      { id: "age_own_hand", title: "I am 18 or older and the hand is my own" },
      {
        id: "residency",
        title: "I do not reside in Illinois, Texas or Washington (USA)",
        summary: "The demo is not available in those states for now.",
      },
    ],
  },
  // Opcional y separado: no condiciona el uso de la demo.
  optional: {
    es: { id: "share_stats", title: "Compartir estadísticas anónimas para mejorar el modelo: resultado, tipo de dispositivo y país. Nunca imágenes ni IP." },
    en: { id: "share_stats", title: "Share anonymous statistics to help improve the model: result, device type and country. Never images or IP." },
  },
};

const REQUIRED_IDS = CONSENT.items.es.map((i) => i.id);

function checkConsent(c) {
  if (!c || typeof c !== "object") return "falta el consentimiento";
  if (c.version !== CONSENT.version) return "version de consentimiento desactualizada";
  if (c.accepted !== true) return "consentimiento no aceptado";
  const items = Array.isArray(c.items) ? c.items : [];
  const missing = REQUIRED_IDS.filter((id) => !items.includes(id));
  if (missing.length) return `faltan declaraciones: ${missing.join(", ")}`;
  return null;
}

module.exports = { CONSENT, REQUIRED_IDS, checkConsent };
