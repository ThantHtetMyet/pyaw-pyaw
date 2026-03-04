import { v4 as uuidv4 } from 'uuid';
import { config } from './config.js';
import { supabase } from './supabaseClient.js';

const roomsTable = 'room_registry';
const messagesTable = 'room_messages';

const nowIso = () => new Date().toISOString();

const toRoomDto = row => ({
  topic: row.topic,
  message: row.message || '',
  hostId: row.host_id,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  status: row.status,
});

const throwOnError = (error, fallbackMessage) => {
  if (!error) {
    return;
  }
  throw new Error(error.message || fallbackMessage);
};

export const createRoom = async ({ message, hostId, ttlSeconds }) => {
  const roomId = uuidv4();
  const topic = `room/${roomId}`;
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + ttlSeconds * 1000);

  const { data, error } = await supabase
    .from(roomsTable)
    .insert({
      id: roomId,
      topic,
      message: message || '',
      host_id: hostId || null,
      status: 'active',
      created_at: createdAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      last_seen_at: createdAt.toISOString(),
    })
    .select('*')
    .single();

  throwOnError(error, 'Failed to create room');
  return toRoomDto(data);
};

export const listActiveRooms = async () => {
  const { data, error } = await supabase
    .from(roomsTable)
    .select('*')
    .eq('status', 'active')
    .gt('expires_at', nowIso())
    .order('created_at', { ascending: false });

  throwOnError(error, 'Failed to load active rooms');
  return (data || []).map(toRoomDto);
};

export const getRoomByTopic = async topic => {
  const { data, error } = await supabase
    .from(roomsTable)
    .select('*')
    .eq('topic', topic)
    .single();

  if (error && error.code === 'PGRST116') {
    return null;
  }
  throwOnError(error, 'Failed to fetch room');
  return data ? toRoomDto(data) : null;
};

export const touchRoom = async topic => {
  const { error } = await supabase
    .from(roomsTable)
    .update({ last_seen_at: nowIso() })
    .eq('topic', topic);

  throwOnError(error, 'Failed to update room heartbeat');
};

export const markRoomJoined = async ({ topic, guestId }) => {
  const payload = {
    last_seen_at: nowIso(),
    last_joined_at: nowIso(),
    status: 'active',
  };
  if (guestId) {
    payload.last_guest_id = guestId;
  }

  const { error } = await supabase.from(roomsTable).update(payload).eq('topic', topic);
  throwOnError(error, 'Failed to update joined room');
};

export const insertRoomMessage = async ({ topic, senderRole, senderId, text, payload }) => {
  const { error } = await supabase.from(messagesTable).insert({
    id: uuidv4(),
    topic,
    sender_role: senderRole || null,
    sender_id: senderId || null,
    message_text: text || '',
    payload_json: payload || {},
    created_at: nowIso(),
  });

  throwOnError(error, 'Failed to save room message');
};

export const expireOldRooms = async () => {
  const { error } = await supabase
    .from(roomsTable)
    .update({ status: 'expired' })
    .eq('status', 'active')
    .lte('expires_at', nowIso());

  throwOnError(error, 'Failed to expire old rooms');
};

export const defaultTtlSeconds = config.roomTtlSeconds;
