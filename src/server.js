const config = require("./config").load();
const { createModel } = require("./model");
const { createApp } = require("./app");
const { createStats } = require("./stats");

(async () => {
  const model = await createModel({ modelPath: config.modelPath, maxConcurrent: config.maxConcurrentInference });
  const stats = createStats({ config });
  const app = createApp({ config, model, stats });
  app.listen(config.port, () => {
    console.log(
      `[palmyn-demo] puerto ${config.port} · ${model.backend} · modelo ${config.modelLabel} (${model.modelIdHex})` +
        ` · umbral ${config.simThreshold} · frames ${config.framesMin}-${config.framesMax}` +
        ` · estadisticas ${stats.enabled ? stats.backend : "apagadas"}`
    );
  });
})().catch((e) => {
  console.error(`[palmyn-demo] no arranco: ${e.message}`);
  process.exit(1);
});
