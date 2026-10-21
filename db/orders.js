export function savePendingOrder(database, {
  id,
  paypalOrderId,
  items,
  customer,
  totalCents
}) {
  database.prepare(
    `INSERT INTO orders (
       id, paypal_order_id, status, currency, total_cents, items, customer
     ) VALUES (?, ?, 'pending_payment', 'EUR', ?, ?, ?)`
  ).run(id, paypalOrderId, totalCents, JSON.stringify(items), JSON.stringify(customer));
}

export function getOrderByPaypalId(database, paypalOrderId) {
  return database.prepare(
    `SELECT id, paypal_order_id, paypal_capture_id, status, currency, total_cents
     FROM orders WHERE paypal_order_id = ?`
  ).get(paypalOrderId) || null;
}

export function markOrderPaid(database, paypalOrderId, captureId) {
  const result = database.prepare(
    `UPDATE orders
     SET status = 'paid', paypal_capture_id = ?, paid_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE paypal_order_id = ? AND status = 'pending_payment'`
  ).run(captureId, paypalOrderId);
  if (result.changes === 0) return null;
  return getPaidOrderByPaypalId(database, paypalOrderId);
}

export function getPaidOrderByPaypalId(database, paypalOrderId) {
  return database.prepare(
    `SELECT id, paypal_order_id, paypal_capture_id, status, currency, total_cents
     FROM orders
     WHERE paypal_order_id = ? AND status = 'paid'`
  ).get(paypalOrderId) || null;
}
