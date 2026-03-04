import { EventEmitter } from 'events';

const roomEventsEmitter = new EventEmitter();

export const publishRoomEvent = event => {
  roomEventsEmitter.emit('room-update', {
    ...event,
    updatedAt: Date.now(),
  });
};

export const subscribeRoomEvents = listener => {
  roomEventsEmitter.on('room-update', listener);
  return () => {
    roomEventsEmitter.off('room-update', listener);
  };
};
