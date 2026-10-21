import test from "node:test";
import assert from "node:assert/strict";
import { buildPaypalOrder, HttpError, validateCheckout, validatePaypalCapture } from "./paypal.js";
import { products } from "../public/catalog.js";

const validBody = {
  items: [{ id: "fraisier", quantity: 2 }, { id: "citron", quantity: 1 }],
  customer: {
    name: "Camille Dupont",
    email: "camille@example.fr",
    date: "2030-01-20",
    message: "Joyeux anniversaire"
  }
};

test("calcule le total avec le catalogue serveur, pas avec un prix client", () => {
  const bodyWithUntrustedPrice = {
    ...validBody,
    items: validBody.items.map((item) => ({ ...item, price: 0.01 }))
  };
  const order = validateCheckout(bodyWithUntrustedPrice, products, "2030-01-01");
  assert.equal(order.total, 135);
  assert.equal(buildPaypalOrder(order, "internal-order-id").purchase_units[0].amount.value, "135.00");
});

test("inclut un identifiant de commande dans la référence PayPal", () => {
  const order = validateCheckout(validBody, products, "2030-01-01");
  const paypalOrder = buildPaypalOrder(order, "internal-order-id");
  assert.equal(paypalOrder.purchase_units[0].invoice_id, "internal-order-id");
  assert.equal(paypalOrder.purchase_units[0].reference_id, "internal-order-id");
});

test("ne valide que la capture du montant et de la commande stockés", () => {
  const order = {
    id: "internal-order-id",
    paypal_order_id: "PAYPAL-ORDER-12345678",
    currency: "EUR",
    total_cents: 13500
  };
  const capture = {
    id: "PAYPAL-CAPTURE-12345678",
    status: "COMPLETED",
    amount: { currency_code: "EUR", value: "135.00" }
  };
  const result = {
    id: order.paypal_order_id,
    status: "COMPLETED",
    purchase_units: [{
      reference_id: order.id,
      payments: { captures: [capture] }
    }]
  };
  assert.equal(validatePaypalCapture(result, order), capture);
  assert.equal(validatePaypalCapture({
    ...result,
    purchase_units: [{
      reference_id: order.id,
      payments: {
        captures: [{ ...capture, amount: { currency_code: "EUR", value: "0.01" } }]
      }
    }]
  }, order), null);
  assert.equal(validatePaypalCapture({ ...result, id: "OTHER-ORDER-12345678" }, order), null);
});

test("rejette un produit absent du catalogue", () => {
  assert.throws(
    () => validateCheckout({ ...validBody, items: [{ id: "cake-free", quantity: 1, price: 0.01 }] }, products),
    (error) => error instanceof HttpError && error.status === 400
  );
});

test("rejette les quantités invalides ou exagérées", () => {
  for (const quantity of [0, -1, 21, 1.5, "2"]) {
    assert.throws(
      () => validateCheckout({ ...validBody, items: [{ id: "fraisier", quantity }] }, products),
      (error) => error instanceof HttpError && error.status === 400
    );
  }
});

test("rejette les commandes sans coordonnées valides ou dont la date est passée", () => {
  const cases = [
    { ...validBody, customer: { ...validBody.customer, email: "not-an-email" } },
    { ...validBody, customer: { ...validBody.customer, date: "2024-02-30" } },
    { ...validBody, customer: { ...validBody.customer, date: "2025-01-01" } }
  ];
  for (const body of cases) {
    assert.throws(
      () => validateCheckout(body, products, "2026-01-01"),
      (error) => error instanceof HttpError && error.status === 400
    );
  }
});
