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
  markRoomLeft,
  terminateRoomByTopic,
} from './roomService.js';
import { publishRoomEvent, subscribeRoomEvents } from './roomEvents.js';

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
      publishRoomEvent({
        type: 'created',
        topic: room.topic,
        availability: room.lastGuestId ? 'busy' : 'idle',
      });
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
      if (!guestId) {
        res.status(400).json({ message: 'guestId is required' });
        return;
      }

      await expireOldRooms();
      const room = await getRoomByTopic(topic);
      if (!room || room.status !== 'active' || Date.parse(room.expiresAt) <= Date.now()) {
        res.status(404).json({ message: 'room not found or expired' });
        return;
      }
      if (room.lastGuestId && room.lastGuestId !== guestId) {
        res.status(409).json({ message: 'room already joined by another guest' });
        return;
      }

      await markRoomJoined({ topic, guestId });
      publishRoomEvent({
        type: 'availability',
        topic,
        availability: 'busy',
      });
      res.json({ room });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post('/api/rooms/leave', async (req, res) => {
    try {
      const topic = typeof req.body?.topic === 'string' ? req.body.topic.trim() : '';
      const guestId = typeof req.body?.guestId === 'string' ? req.body.guestId : null;
      if (!topic) {
        res.status(400).json({ message: 'topic is required' });
        return;
      }
      if (!guestId) {
        res.status(400).json({ message: 'guestId is required' });
        return;
      }
      await markRoomLeft({ topic, guestId });
      publishRoomEvent({
        type: 'availability',
        topic,
        availability: 'idle',
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post('/api/rooms/terminate', async (req, res) => {
    try {
      const topic = typeof req.body?.topic === 'string' ? req.body.topic.trim() : '';
      if (!topic) {
        res.status(400).json({ message: 'topic is required' });
        return;
      }
      await terminateRoomByTopic(topic);
      publishRoomEvent({
        type: 'terminated',
        topic,
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/rooms/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    res.write(`data: ${JSON.stringify({ type: 'connected', updatedAt: Date.now() })}\n\n`);
    const unsubscribe = subscribeRoomEvents(event => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    const pingInterval = setInterval(() => {
      res.write(`event: ping\ndata: ${Date.now()}\n\n`);
    }, 25000);

    req.on('close', () => {
      clearInterval(pingInterval);
      unsubscribe();
      res.end();
    });
  });

  app.get('/api/mqtt/config', (req, res) => {
    const host = req.get('host') || `localhost:${process.env.PORT || 4000}`;
    const forwardedProto = req.get('x-forwarded-proto');
    const protocol = forwardedProto === 'https' || req.protocol === 'https' ? 'wss' : 'ws';
    res.json({
      protocol,
      host,
      path: '/mqtt',
      roomTopicPrefix: 'room/{room-id}',
      channels: ['presence', 'chat'],
    });
  });

  return app;
};
