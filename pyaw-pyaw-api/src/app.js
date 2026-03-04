import cors from 'cors';
import express from 'express';
import morgan from 'morgan';
import {
  createRoom,
  defaultTtlSeconds,
  expireOldRooms,
  getRoomByTopic,
  listActiveRooms,
  markRoomJoined,
} from './roomService.js';

export const createApp = () => {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '256kb' }));
  app.use(morgan('dev'));

  app.get('/health', async (req, res) => {
    try {
      await expireOldRooms();
      res.json({ ok: true, service: 'pyaw-pyaw-api' });
    } catch (error) {
      res.status(500).json({ ok: false, message: error.message });
    }
  });

  app.get('/api/rooms/active', async (req, res) => {
    try {
      await expireOldRooms();
      const rooms = await listActiveRooms();
      res.json({ rooms });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post('/api/rooms', async (req, res) => {
    try {
      const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      const hostId = typeof req.body?.hostId === 'string' ? req.body.hostId : null;
      const requestedTtl = Number(req.body?.ttlSeconds);
      const ttlSeconds = Number.isFinite(requestedTtl) && requestedTtl > 0 ? requestedTtl : defaultTtlSeconds;
      const room = await createRoom({ message, hostId, ttlSeconds });
      res.status(201).json({ room });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post('/api/rooms/join', async (req, res) => {
    try {
      const topic = typeof req.body?.topic === 'string' ? req.body.topic.trim() : '';
      const guestId = typeof req.body?.guestId === 'string' ? req.body.guestId : null;
      if (!topic) {
        res.status(400).json({ message: 'topic is required' });
        return;
      }

      await expireOldRooms();
      const room = await getRoomByTopic(topic);
      if (!room || room.status !== 'active' || Date.parse(room.expiresAt) <= Date.now()) {
        res.status(404).json({ message: 'room not found or expired' });
        return;
      }

      await markRoomJoined({ topic, guestId });
      res.json({ room });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/mqtt/config', (req, res) => {
    const host = req.get('host') || `localhost:${process.env.PORT || 4000}`;
    const wsHost = host.includes(':')
      ? `${host.split(':')[0]}:${process.env.MQTT_WS_PORT || 4001}`
      : `${host}:${process.env.MQTT_WS_PORT || 4001}`;
    res.json({
      protocol: 'ws',
      host: wsHost,
      path: '/mqtt',
      roomTopicPrefix: 'room/{room-id}',
      channels: ['presence', 'chat'],
    });
  });

  return app;
};
