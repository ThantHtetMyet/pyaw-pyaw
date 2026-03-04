create extension if not exists "pgcrypto";

create table if not exists public.room_registry (
  id uuid primary key default gen_random_uuid(),
  topic text not null unique,
  message text not null default '',
  host_id text,
  last_guest_id text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz,
  last_joined_at timestamptz
);

create index if not exists room_registry_status_idx on public.room_registry(status);
create index if not exists room_registry_expires_at_idx on public.room_registry(expires_at);
create index if not exists room_registry_created_at_idx on public.room_registry(created_at desc);

create table if not exists public.room_messages (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  sender_role text,
  sender_id text,
  message_text text not null default '',
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists room_messages_topic_created_idx on public.room_messages(topic, created_at desc);
