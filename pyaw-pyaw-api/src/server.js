import { createApp } from './app.js';
import { assertRequiredConfig, config } from './config.js';
import { startMqttBroker } from './mqttBroker.js';

const bootstrap = async () => {
  assertRequiredConfig();

  const app = createApp();
  const httpServer = app.listen(config.port, () => {
    console.log(`HTTP API listening on port ${config.port}`);
  });

  const mqttServer = await startMqttBroker();
  console.log(`MQTT over WebSocket listening on port ${config.mqttWsPort}`);

  const shutdown = async () => {
    await mqttServer.close();
    await new Promise(resolve => httpServer.close(resolve));
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

bootstrap().catch(error => {
  console.error(error.message);
  process.exit(1);
});
