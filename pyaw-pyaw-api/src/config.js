import dotenv from 'dotenv';

dotenv.config();

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: toNumber(process.env.PORT, 4000),
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '',
  roomTtlSeconds: toNumber(process.env.ROOM_TTL_SECONDS, 300),
};

export const assertRequiredConfig = () => {
  const missing = [];
  if (!config.supabaseUrl) {
    missing.push('SUPABASE_URL');
  }
  if (!config.supabaseServiceRoleKey) {
    missing.push('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY');
  }
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
};
