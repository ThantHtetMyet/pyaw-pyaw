import Aedes from 'aedes';
import { WebSocketServer, createWebSocketStream } from 'ws';
import { insertRoomMessage, markRoomJoined, markRoomLeft, touchRoom } from './roomService.js';
import { publishRoomEvent } from './roomEvents.js';

const parseJson = value => {
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
};

const parseTopic = topic => {
  const parts = (topic || '').split('/');
  if (parts.length < 3 || parts[0] !== 'room') {
    return null;
  }
  return {
    roomTopic: `${parts[0]}/${parts[1]}`,
    channel: parts.slice(2).join('/'),
  };
};

export const startMqttBroker = server =>
  new Promise((resolve, reject) => {
    if (!server) {
      reject(new Error('HTTP server is required for MQTT broker startup'));
      return;
    }

    const broker = new Aedes();
    const wsServer = new WebSocketServer({ server, path: '/mqtt' });

    wsServer.on('connection', stream => {
      const duplexStream = createWebSocketStream(stream);
      broker.handle(duplexStream);
    });

    broker.on('publish', async packet => {
      if (!packet?.topic || !packet?.payload) {
        return;
      }
      if (packet.topic.startsWith('$SYS/')) {
        return;
      }

      const parsedTopic = parseTopic(packet.topic);
      if (!parsedTopic) {
        return;
      }

      const payloadText = packet.payload.toString('utf8');
      const payload = parseJson(payloadText);

      try {
        await touchRoom(parsedTopic.roomTopic);
        if (parsedTopic.channel === 'presence') {
          if (payload?.type === 'join' && payload?.senderRole === 'guest') {
            await markRoomJoined({
              topic: parsedTopic.roomTopic,
              guestId: payload.clientId || packet.clientId,
            });
            publishRoomEvent({
              type: 'availability',
              topic: parsedTopic.roomTopic,
              availability: 'busy',
            });
          }
          if (payload?.type === 'leave' && payload?.senderRole === 'guest') {
            await markRoomLeft({
              topic: parsedTopic.roomTopic,
              guestId: payload.clientId || packet.clientId,
            });
            publishRoomEvent({
              type: 'availability',
              topic: parsedTopic.roomTopic,
              availability: 'idle',
            });
          }
          if (payload?.type === 'join' || payload?.type === 'leave') {
            await insertRoomMessage({
              topic: parsedTopic.roomTopic,
              senderRole: payload?.senderRole,
              senderId: payload?.senderId || payload?.clientId || packet.clientId,
              text: payload?.type === 'leave' ? 'User left room.' : 'User joined room.',
              payload: payload || {},
            });
          }
          return;
        }

        if (parsedTopic.channel === 'chat') {
          await insertRoomMessage({
            topic: parsedTopic.roomTopic,
            senderRole: payload?.senderRole,
            senderId: payload?.senderId || packet.clientId,
            text: payload?.text || payloadText,
            payload: payload || {},
          });
        }
      } catch (error) {
        console.error('MQTT publish handling error:', error.message);
      }
    });

    resolve({
      broker,
      wsServer,
      close: () =>
        new Promise(closeResolve => {
          wsServer.close(() => {
            broker.close(() => {
              closeResolve();
            });
          });
        }),
    });
    wsServer.on('error', reject);
  });
