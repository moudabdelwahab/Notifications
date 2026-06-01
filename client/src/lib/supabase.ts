// Supabase configuration
// Note: These are public credentials for client-side use
export const SUPABASE_URL = 'https://ywjtqkkbxqnisduelgre.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3anRxa2tieHFuaXNkdWVsZ3JlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzNDA4MjEsImV4cCI6MjA5NTkxNjgyMX0.mswnD7P2GrFdljM3XsEiW-k2knK9RVHvwwxbkSQ9mPs';

// Initialize Supabase client
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

// Database types
export interface User {
  id: string;
  email: string;
  google_id: string;
  telegram_api_id: string | null;
  telegram_api_hash: string | null;
  telegram_phone: string | null;
  monitoring_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: 'mention' | 'reply';
  source: string; // group name, channel name, or user name
  message_text: string;
  message_link: string | null;
  sender_name: string;
  created_at: string;
  read: boolean;
}

export interface TelegramSession {
  id: string;
  user_id: string;
  session_data: string;
  phone: string;
  created_at: string;
  updated_at: string;
}
