import { createApp } from './app.js';
import { assertRequiredConfig, config } from './config.js';
import { startMqttBroker } from './mqttBroker.js';
import { createServer } from 'http';

const bootstrap = async () => {
  assertRequiredConfig();

  const app = createApp();
  const httpServer = createServer(app);
  const mqttServer = await startMqttBroker(httpServer);
  httpServer.listen(config.port, '0.0.0.0', () => {
    console.log(`HTTP API listening on port ${config.port}`);
    console.log(`MQTT over WebSocket listening on /mqtt via port ${config.port}`);
  });

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
