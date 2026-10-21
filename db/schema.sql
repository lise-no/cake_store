CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  paypal_order_id TEXT UNIQUE NOT NULL,
  paypal_capture_id TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending_payment', 'paid')),
  currency TEXT NOT NULL CHECK (currency = 'EUR'),
  total_cents INTEGER NOT NULL CHECK (total_cents > 0),
  items TEXT NOT NULL CHECK (json_valid(items)),
  customer TEXT NOT NULL CHECK (json_valid(customer)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  paid_at TEXT
);

CREATE INDEX IF NOT EXISTS orders_status_created_at_idx
  ON orders (status, created_at DESC);
