const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LINES = 20;
const MAX_QUANTITY = 20;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isValidCalendarDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateCheckout(body, products, today = new Date().toISOString().slice(0, 10)) {
  if (!body || !Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_LINES) {
    throw new HttpError(400, "Le panier est vide ou invalide.");
  }

  const productById = new Map(products.map((product) => [product.id, product]));
  const seenIds = new Set();
  const items = body.items.map((item) => {
    if (!item || typeof item.id !== "string" || seenIds.has(item.id)) {
      throw new HttpError(400, "Le panier contient un article invalide ou en double.");
    }
    const product = productById.get(item.id);
    if (!product || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY) {
      throw new HttpError(400, "Un article ou une quantité du panier est invalide.");
    }
    seenIds.add(item.id);
    return { product, quantity: item.quantity };
  });

  const customer = body.customer;
  if (!customer || typeof customer !== "object") {
    throw new HttpError(400, "Les coordonnées de commande sont obligatoires.");
  }
  const name = typeof customer.name === "string" ? customer.name.trim() : "";
  const email = typeof customer.email === "string" ? customer.email.trim() : "";
  const date = typeof customer.date === "string" ? customer.date : "";
  const message = typeof customer.message === "string" ? customer.message.trim() : "";

  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new HttpError(400, "Le nom doit contenir entre 1 et 80 caractères.");
  }
  if (!email || email.length > 120 || !EMAIL_PATTERN.test(email)) {
    throw new HttpError(400, "L’adresse e-mail est invalide.");
  }
  if (!isValidCalendarDate(date) || date < today) {
    throw new HttpError(400, "La date souhaitée est invalide ou déjà passée.");
  }
  if (message.length > 500) {
    throw new HttpError(400, "Le message ne peut pas dépasser 500 caractères.");
  }

  const total = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  return { items, customer: { name, email, date, message }, total };
}

export function buildPaypalOrder(validatedOrder, invoiceId) {
  const itemTotal = validatedOrder.total.toFixed(2);
  const items = validatedOrder.items.map(({ product, quantity }) => ({
    name: product.name.slice(0, 127),
    quantity: String(quantity),
    unit_amount: { currency_code: "EUR", value: product.price.toFixed(2) },
    category: "PHYSICAL_GOODS"
  }));
  return {
    intent: "CAPTURE",
    purchase_units: [{
      reference_id: invoiceId,
      invoice_id: invoiceId,
      custom_id: invoiceId,
      description: `Commande Maison Sucrée pour le ${validatedOrder.customer.date}`,
      amount: {
        currency_code: "EUR",
        value: itemTotal,
        breakdown: { item_total: { currency_code: "EUR", value: itemTotal } }
      },
      items
    }],
    payment_source: {
      paypal: {
        experience_context: {
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW"
        }
      }
    }
  };
}

export function validatePaypalCapture(result, order) {
  if (result?.id !== order.paypal_order_id || result.status !== "COMPLETED") return null;
  const purchaseUnit = result.purchase_units?.find(
    (unit) => unit.reference_id === order.id || unit.invoice_id === order.id
  );
  const capture = purchaseUnit?.payments?.captures?.find((entry) => entry.status === "COMPLETED");
  if (!capture?.id || capture.amount?.currency_code !== order.currency) return null;
  const capturedCents = Number(capture.amount.value) * 100;
  if (!Number.isSafeInteger(capturedCents) || capturedCents !== order.total_cents) return null;
  return capture;
}
