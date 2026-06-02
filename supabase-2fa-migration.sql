-- Migration: Add Two-Step Verification (2FA) support to otp_sessions table

-- Add new columns to track 2FA state
ALTER TABLE public.otp_sessions 
ADD COLUMN IF NOT EXISTS auth_state TEXT DEFAULT 'pending_otp' CHECK (auth_state IN ('pending_otp', 'pending_password', 'completed')),
ADD COLUMN IF NOT EXISTS password_hint TEXT,
ADD COLUMN IF NOT EXISTS session_string TEXT;

-- Create index for auth_state to speed up queries
CREATE INDEX IF NOT EXISTS idx_otp_sessions_auth_state ON public.otp_sessions(auth_state);

-- Add comment to document the auth_state values
COMMENT ON COLUMN public.otp_sessions.auth_state IS 
'Tracks authentication state: pending_otp (waiting for phone code), pending_password (waiting for 2FA password), completed (ready to create session)';

COMMENT ON COLUMN public.otp_sessions.password_hint IS 
'Hint about the 2FA password (e.g., "Hint: your password is..." from Telegram)';

COMMENT ON COLUMN public.otp_sessions.session_string IS 
'Temporary session string for 2FA password verification step';
