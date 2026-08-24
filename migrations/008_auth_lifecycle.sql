-- Migration 008: Auth lifecycle — email verification + password reset tokens.
--
-- Prinsip: token disimpan sebagai SHA-256 hash (bukan plaintext); satu token =
-- satu pemakaian; kedaluwarsa pendek. Tanpa mengubah history 001-007.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

CREATE TABLE IF NOT EXISTS auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('EMAIL_VERIFY','PASSWORD_RESET')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id, kind);

GRANT SELECT, INSERT, UPDATE ON auth_tokens TO aee_app;

-- email verification + password reset menyentuh kolom users (email_verified_at, password_hash)
GRANT UPDATE (email_verified_at, password_hash) ON users TO aee_app;
GRANT DELETE ON sessions TO aee_app;
