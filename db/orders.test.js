import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  getOrderByPaypalId,
  getPaidOrderByPaypalId,
  markOrderPaid,
  savePendingOrder
} from "./orders.js";

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  return database;
}

test("enregistre et retrouve une commande en attente dans SQLite", () => {
  const database = createDatabase();
  const record = {
    id: "a5d96019-a17b-4e60-a6dc-3b88447a4e2e",
    paypalOrderId: "PAYPAL-ORDER-12345678",
    items: [{ id: "fraisier", quantity: 2, unitPrice: 48 }],
    customer: { email: "client@example.fr" },
    totalCents: 9600
  };

  savePendingOrder(database, record);
  const stored = getOrderByPaypalId(database, record.paypalOrderId);

  assert.equal(stored.id, record.id);
  assert.equal(stored.status, "pending_payment");
  assert.equal(stored.currency, "EUR");
  assert.equal(stored.total_cents, 9600);
  database.close();
});

test("ne permet de marquer comme payée que la commande en attente", () => {
  const database = createDatabase();
  const record = {
    id: "a5d96019-a17b-4e60-a6dc-3b88447a4e2e",
    paypalOrderId: "PAYPAL-ORDER-12345678",
    items: [{ id: "fraisier", quantity: 2, unitPrice: 48 }],
    customer: { email: "client@example.fr" },
    totalCents: 9600
  };
  savePendingOrder(database, record);

  const paid = markOrderPaid(database, record.paypalOrderId, "PAYPAL-CAPTURE-12345678");

  assert.equal(paid.status, "paid");
  assert.equal(paid.paypal_capture_id, "PAYPAL-CAPTURE-12345678");
  assert.equal(getPaidOrderByPaypalId(database, record.paypalOrderId).id, record.id);
  assert.equal(markOrderPaid(database, record.paypalOrderId, "ANOTHER-CAPTURE-12345678"), null);
  database.close();
});

test("rejette une référence de paiement ou des données de commande dupliquées", () => {
  const database = createDatabase();
  const record = {
    id: "a5d96019-a17b-4e60-a6dc-3b88447a4e2e",
    paypalOrderId: "PAYPAL-ORDER-12345678",
    items: [{ id: "fraisier", quantity: 2, unitPrice: 48 }],
    customer: { email: "client@example.fr" },
    totalCents: 9600
  };
  savePendingOrder(database, record);

  assert.throws(() => savePendingOrder(database, record), /UNIQUE constraint failed/);
  database.close();
});
