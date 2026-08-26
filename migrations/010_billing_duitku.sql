-- 010_billing_duitku.sql — Duitku POP billing (fase monetize).
-- Invoices langganan: PENDING saat checkout → PAID/FAILED/EXPIRED via callback
-- terverifikasi MD5. Transisi satu arah dari PENDING (idempoten utk retry).
CREATE TABLE IF NOT EXISTS billing_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  plan_tier text NOT NULL CHECK (plan_tier IN ('STARTER','GROWTH','ENTERPRISE')),
  period_months int NOT NULL CHECK (period_months IN (1,3,12)),
  amount numeric(20,2) NOT NULL CHECK (amount > 0),
  merchant_order_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','FAILED','EXPIRED')),
  duitku_reference text,
  payment_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_org ON billing_invoices(organization_id, created_at DESC);

-- Audit event billing masuk ke events (reuse arsitektur audit yang ada):
-- jenis event pakai prefix BILLING_* agar filter Activity tetap bersih.
