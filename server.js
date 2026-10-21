import "dotenv/config";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { products } from "./public/catalog.js";
import {
  getOrderByPaypalId,
  getPaidOrderByPaypalId,
  markOrderPaid,
  savePendingOrder
} from "./db/orders.js";
import {
  buildPaypalOrder,
  HttpError,
  validateCheckout,
  validatePaypalCapture
} from "./server/paypal.js";

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(rootDirectory, "public");
const port = Number(process.env.PORT) || 3000;
const configuredDatabasePath = process.env.DATABASE_PATH || path.join(rootDirectory, "data", "orders.sqlite");
const databasePath = configuredDatabasePath === ":memory:"
  ? configuredDatabasePath
  : path.resolve(rootDirectory, configuredDatabasePath);
const paypalEnvironment = process.env.PAYPAL_ENV || "sandbox";
if (!["sandbox", "live"].includes(paypalEnvironment)) {
  throw new Error("PAYPAL_ENV doit être « sandbox » ou « live ».");
}
const paypalApiBase = paypalEnvironment === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";
const workshopEmail = process.env.WORKSHOP_EMAIL || "bonjour@maisonsucree.fr";

if (databasePath !== ":memory:") {
  mkdirSync(path.dirname(databasePath), { recursive: true });
}

const database = new DatabaseSync(databasePath);

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb", strict: true }));

async function getPaypalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new HttpError(503, "PayPal n’est pas configuré. Ajoutez PAYPAL_CLIENT_ID et PAYPAL_CLIENT_SECRET aux variables Railway.");
  }

  let response;
  try {
    response = await fetch(`${paypalApiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(10_000)
    });
  } catch (error) {
    console.error("Impossible de joindre PayPal pour obtenir un jeton.", error);
    throw new HttpError(502, "PayPal est momentanément inaccessible. Réessayez plus tard.");
  }

  if (!response.ok) {
    console.error("PayPal a refusé l’authentification du serveur.", { status: response.status });
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(503, "PayPal refuse ces identifiants. Vérifiez que le Client ID, le Secret et PAYPAL_ENV proviennent du même environnement.");
    }
    throw new HttpError(502, "La connexion du serveur à PayPal a échoué. Vérifiez le mode Sandbox/Live et vos identifiants API.");
  }

  const result = await response.json();
  if (typeof result.access_token !== "string" || result.access_token.length === 0) {
    throw new HttpError(502, "PayPal n’a pas fourni de jeton de paiement valide.");
  }
  return result.access_token;
}

async function paypalRequest(endpoint, { method, body, requestId }) {
  const accessToken = await getPaypalAccessToken();
  let response;
  try {
    response = await fetch(`${paypalApiBase}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(requestId ? { "PayPal-Request-Id": requestId } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000)
    });
  } catch (error) {
    console.error("La requête de paiement PayPal a échoué.", error);
    throw new HttpError(502, "PayPal n’a pas répondu. Vérifiez votre compte avant de réessayer.");
  }

  let result;
  try {
    result = await response.json();
  } catch (error) {
    console.error("Réponse PayPal illisible.", { status: response.status, error });
    throw new HttpError(502, "La réponse de PayPal est invalide.");
  }
  if (!response.ok) {
    console.error("PayPal a refusé une opération de paiement.", {
      status: response.status,
      issue: result.details?.[0]?.issue || result.name
    });
    const message = response.status === 422
      ? "PayPal ne peut pas traiter cette commande. Vérifiez votre compte et réessayez."
      : "PayPal n’a pas pu traiter cette demande. Réessayez plus tard.";
    throw new HttpError(response.status === 422 ? 409 : 502, message);
  }
  return result;
}

function initializeDatabase() {
  const schema = readFileSync(new URL("./db/schema.sql", import.meta.url), "utf8");
  database.exec(schema);
  database.prepare("SELECT 1").get();
  console.log(`Base SQLite prête (${databasePath}).`);
}

app.get("/api/health", (_request, response, next) => {
  try {
    database.prepare("SELECT 1").get();
    response.json({ status: "ok", database: "connected", engine: "sqlite" });
  } catch (error) {
    next(error);
  }
});

app.get("/api/config", (_request, response) => {
  const paypalConfigured = Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
  response.json({
    paypalConfigured,
    paypalClientId: paypalConfigured ? process.env.PAYPAL_CLIENT_ID : null,
    workshopEmail,
    environment: paypalEnvironment
  });
});

app.post("/api/paypal/orders", async (request, response, next) => {
  try {
    const validatedOrder = validateCheckout(request.body, products);
    const id = randomUUID();
    const items = validatedOrder.items.map(({ product, quantity }) => ({
      id: product.id,
      name: product.name,
      quantity,
      unitPrice: product.price
    }));
    const result = await paypalRequest("/v2/checkout/orders", {
      method: "POST",
      body: buildPaypalOrder(validatedOrder, id),
      requestId: id
    });
    if (typeof result.id !== "string" || result.status !== "CREATED") {
      console.error("PayPal a retourné une commande incomplète.", { status: result.status });
      throw new HttpError(502, "PayPal n’a pas pu préparer le paiement.");
    }

    try {
      savePendingOrder(database, {
        id,
        paypalOrderId: result.id,
        items,
        customer: validatedOrder.customer,
        totalCents: validatedOrder.total * 100
      });
    } catch (error) {
      console.error("Impossible d’enregistrer la commande PayPal créée.", {
        orderId: result.id,
        error
      });
      throw new HttpError(503, "La commande n’a pas pu être enregistrée. Aucun paiement n’a été confirmé ; contactez l’atelier avant de réessayer.");
    }
    response.status(201).json({ id: result.id });
  } catch (error) {
    next(error);
  }
});

app.post("/api/paypal/orders/:orderId/capture", async (request, response, next) => {
  try {
    const { orderId } = request.params;
    if (!/^[A-Z0-9-]{8,64}$/i.test(orderId)) {
      throw new HttpError(400, "La référence PayPal est invalide.");
    }

    const storedOrder = getOrderByPaypalId(database, orderId);
    if (!storedOrder) throw new HttpError(404, "Cette commande PayPal n’est pas enregistrée.");
    if (storedOrder.status === "paid") {
      response.json({
        status: "COMPLETED",
        id: storedOrder.paypal_capture_id,
        orderId: storedOrder.id
      });
      return;
    }

    const result = await paypalRequest(
      `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
      {
        method: "POST",
        requestId: `capture-${orderId}`.slice(0, 38)
      }
    );
    const capture = validatePaypalCapture(result, storedOrder);
    if (!capture) {
      console.error("La capture PayPal ne correspond pas au montant ou à la commande enregistrée.", {
        orderId,
        status: result.status
      });
      throw new HttpError(409, "Le paiement ne correspond pas à la commande. L’atelier doit vérifier le paiement avant validation.");
    }

    let paidOrder = markOrderPaid(database, orderId, capture.id);
    if (!paidOrder) paidOrder = getPaidOrderByPaypalId(database, orderId);
    if (!paidOrder) {
      throw new HttpError(503, "Le paiement a été effectué mais son enregistrement échoue. Notez la référence PayPal et contactez l’atelier.");
    }
    response.json({
      status: "COMPLETED",
      id: paidOrder.paypal_capture_id,
      orderId: paidOrder.id
    });
  } catch (error) {
    next(error);
  }
});

app.use("/api", (_request, response) => {
  response.status(404).json({ error: "Cette route API n’existe pas." });
});

app.use(express.static(publicDirectory, {
  dotfiles: "deny",
  index: "index.html",
  maxAge: process.env.NODE_ENV === "production" ? "1h" : 0
}));

app.use((error, _request, response, _next) => {
  if (error instanceof SyntaxError && "body" in error) {
    response.status(400).json({ error: "La requête JSON est invalide." });
    return;
  }
  if (error instanceof HttpError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  if (error?.code === "SQLITE_CONSTRAINT_UNIQUE" || error?.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
    console.error("Conflit de référence lors de l’enregistrement de commande.", error);
    response.status(409).json({ error: "Cette demande de paiement est déjà enregistrée. Actualisez le panier et réessayez." });
    return;
  }
  console.error("Erreur serveur inattendue.", error);
  response.status(500).json({ error: "Une erreur inattendue est survenue. Réessayez plus tard." });
});

function start() {
  initializeDatabase();
  const server = app.listen(port, "0.0.0.0", () => {
    console.log(`Maison Sucrée disponible sur le port ${port} (${paypalEnvironment}).`);
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      server.close(() => {
        database.close();
        process.exit(0);
      });
    });
  }
}

try {
  start();
} catch (error) {
  console.error("Impossible de démarrer Maison Sucrée. Vérifiez que le fichier de base de données est accessible.", error);
  database.close();
  process.exitCode = 1;
}
