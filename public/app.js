import { products } from "./catalog.js";

const formatPrice = (price) => new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0
}).format(price);

const productGrid = document.querySelector("#product-grid");
const cartCount = document.querySelector("#cart-count");
const cartItems = document.querySelector("#cart-items");
const cartSubtotal = document.querySelector("#cart-subtotal");
const cartEmpty = document.querySelector("#cart-empty");
const cartBottom = document.querySelector("#cart-bottom");
const cartDrawer = document.querySelector("#cart-drawer");
const overlay = document.querySelector("#overlay");
const checkoutDialog = document.querySelector("#checkout-dialog");
const checkoutForm = document.querySelector("#checkout-form");
const paymentStatus = document.querySelector("#payment-status");
let activeCategory = "Tous";
let toastTimeout;
let cart = loadCart();
let checkoutConfig;
let paypalSdkPromise;
let paymentInProgress = false;
let latestOrderEmail = "";
let pendingCheckoutDetails;
let pendingCheckoutItems;
let pendingCheckoutTotal;

function loadCart() {
  try {
    const storedCart = JSON.parse(localStorage.getItem("maison-sucree-cart") || "[]");
    if (!Array.isArray(storedCart)) return [];
    return storedCart.filter((item) =>
      item && products.some((product) => product.id === item.id) &&
      Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 20
    );
  } catch (error) {
    console.error("Impossible de lire le panier enregistré.", error);
    return [];
  }
}

function saveCart() {
  try {
    localStorage.setItem("maison-sucree-cart", JSON.stringify(cart));
  } catch (error) {
    console.error("Impossible d’enregistrer le panier.", error);
    showToast("Le panier ne peut pas être enregistré sur cet appareil.");
  }
}

function renderProducts() {
  const query = document.querySelector("#search").value.trim().toLocaleLowerCase("fr");
  const visibleProducts = products.filter((product) => {
    const matchesCategory = activeCategory === "Tous" || product.category === activeCategory;
    const matchesSearch = `${product.name} ${product.description} ${product.category}`.toLocaleLowerCase("fr").includes(query);
    return matchesCategory && matchesSearch;
  });

  if (visibleProducts.length === 0) {
    productGrid.innerHTML = '<p class="empty-results">Aucune douceur ne correspond à votre recherche.</p>';
    return;
  }

  productGrid.innerHTML = visibleProducts.map((product) => `
    <article class="product-card">
      <div class="product-photo">
        <img src="${product.image}" alt="${product.alt}" loading="lazy" />
        <span class="product-tag">${product.tag}</span>
        <button class="add-button" data-add="${product.id}" aria-label="Ajouter ${product.name} au panier">+</button>
      </div>
      <div class="product-info">
        <div><h3>${product.name}</h3><p class="product-description">${product.description}</p></div>
        <span class="product-price">${formatPrice(product.price)}</span>
      </div>
    </article>
  `).join("");
}

function getCartTotal() {
  return cart.reduce((sum, item) => {
    const product = products.find((entry) => entry.id === item.id);
    return sum + (product ? product.price * item.quantity : 0);
  }, 0);
}

function renderCart() {
  const totalQuantity = cart.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = getCartTotal();

  cartCount.textContent = String(totalQuantity);
  cartEmpty.hidden = cart.length > 0;
  cartBottom.hidden = cart.length === 0;
  cartSubtotal.textContent = formatPrice(totalPrice);
  document.querySelector("#checkout-total").textContent = formatPrice(totalPrice);
  cartItems.innerHTML = cart.map((item) => {
    const product = products.find((entry) => entry.id === item.id);
    if (!product) return "";
    return `
      <article class="cart-line">
        <img src="${product.image}" alt="" />
        <div>
          <h3>${product.name}</h3>
          <p>${formatPrice(product.price)} · ${formatPrice(product.price * item.quantity)}</p>
          <div class="quantity-controls" aria-label="Quantité de ${product.name}">
            <button data-quantity="${product.id}" data-change="-1" aria-label="Retirer une unité">−</button>
            <span>${item.quantity}</span>
            <button data-quantity="${product.id}" data-change="1" aria-label="Ajouter une unité">+</button>
          </div>
        </div>
        <button class="remove-item" data-remove="${product.id}" aria-label="Supprimer ${product.name}">×</button>
      </article>
    `;
  }).join("");
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove("visible"), 3000);
}

function addToCart(id) {
  const existing = cart.find((item) => item.id === id);
  if (existing) {
    if (existing.quantity >= 20) {
      showToast("La quantité maximale pour ce gâteau est de 20.");
      return;
    }
    existing.quantity += 1;
  } else {
    cart.push({ id, quantity: 1 });
  }
  saveCart();
  renderCart();
  showToast("Une jolie douceur ajoutée au panier ♡");
}

function setDrawerOpen(isOpen) {
  cartDrawer.classList.toggle("open", isOpen);
  cartDrawer.setAttribute("aria-hidden", String(!isOpen));
  overlay.hidden = !isOpen;
  document.body.classList.toggle("drawer-open", isOpen);
  if (isOpen) {
    requestAnimationFrame(() => overlay.classList.add("visible"));
    document.querySelector("#close-cart").focus();
  } else {
    overlay.classList.remove("visible");
  }
}

function getCheckoutDetails() {
  const formData = new FormData(checkoutForm);
  return {
    name: String(formData.get("name") || "").trim(),
    email: String(formData.get("email") || "").trim(),
    date: String(formData.get("date") || ""),
    message: String(formData.get("message") || "").trim()
  };
}

function formatOrderEmail(details, paypalOrderId) {
  const orderLines = pendingCheckoutItems.map((item) => {
    const product = products.find((entry) => entry.id === item.id);
    return product ? `- ${product.name} x ${item.quantity} : ${formatPrice(product.price * item.quantity)}` : "";
  }).filter(Boolean);
  const subject = `Commande Maison Sucrée - ${details.name}`;
  const body = [
    "Bonjour Maison Sucrée,",
    "",
    "Mon paiement PayPal est confirmé. Voici les détails de ma commande :",
    ...orderLines,
    "",
    `Total payé : ${formatPrice(pendingCheckoutTotal)}`,
    `Référence PayPal : ${paypalOrderId}`,
    `Nom : ${details.name}`,
    `E-mail : ${details.email}`,
    `Date souhaitée : ${details.date}`,
    details.message ? `Message : ${details.message}` : ""
  ].filter(Boolean).join("\n");
  return { subject, body };
}

function showOrderConfirmation(details, paypalOrderId) {
  const workshopEmail = checkoutConfig.workshopEmail;
  const { subject, body } = formatOrderEmail(details, paypalOrderId);
  const encodedSubject = encodeURIComponent(subject);
  const encodedBody = encodeURIComponent(body);
  const encodedRecipient = encodeURIComponent(workshopEmail);
  const mailtoRecipient = encodedRecipient.replace(/%40/gi, "@");

  latestOrderEmail = `À : ${workshopEmail}\nObjet : ${subject}\n\n${body}`;
  document.querySelector("#customer-name").textContent = details.name.split(/\s+/)[0];
  document.querySelector("#payment-confirmation").textContent =
    `Paiement PayPal confirmé (${paypalOrderId}). Envoyez le récapitulatif à l’atelier pour convenir du retrait ou de la livraison.`;
  document.querySelector("#workshop-email").textContent = workshopEmail;
  document.querySelector("#send-order").href =
    `https://mail.google.com/mail/?view=cm&fs=1&to=${encodedRecipient}&su=${encodedSubject}&body=${encodedBody}`;
  document.querySelector("#mailto-order").href =
    `mailto:${mailtoRecipient}?subject=${encodedSubject}&body=${encodedBody}`;
  document.querySelector("#checkout-content").hidden = true;
  document.querySelector("#order-success").hidden = false;
}

async function copyOrderSummary() {
  try {
    await navigator.clipboard.writeText(latestOrderEmail);
    showToast("Récapitulatif copié. Collez-le dans votre e-mail.");
  } catch (error) {
    console.error("Impossible de copier la commande dans le presse-papiers.", error);
    showToast("Copie indisponible : ouvrez Gmail ou votre logiciel de messagerie.");
  }
}

function getValidCheckoutDetails() {
  if (!checkoutForm.reportValidity()) return null;
  const details = getCheckoutDetails();
  if (!details.name || !details.email || !details.date || details.date < dateInput.min) {
    showToast("Vérifiez vos coordonnées et la date souhaitée.");
    return null;
  }
  if (cart.length === 0) {
    showToast("Votre panier est vide.");
    return null;
  }
  return details;
}

async function createPaypalOrder(details) {
  const response = await fetch("/api/paypal/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: cart.map(({ id, quantity }) => ({ id, quantity })),
      customer: details
    })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "PayPal n’a pas pu préparer le paiement.");
  pendingCheckoutDetails = details;
  pendingCheckoutItems = cart.map(({ id, quantity }) => ({ id, quantity }));
  pendingCheckoutTotal = getCartTotal();
  return result.id;
}

async function capturePaypalOrder(orderId) {
  const response = await fetch(`/api/paypal/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Le paiement n’a pas pu être confirmé.");
  if (result.status !== "COMPLETED") throw new Error("PayPal n’a pas confirmé le paiement. Vérifiez votre compte avant de réessayer.");
  return result;
}

async function loadPaypalSdk() {
  if (window.paypal) return window.paypal;
  if (paypalSdkPromise) return paypalSdkPromise;

  const script = document.createElement("script");
  const query = new URLSearchParams({
    "client-id": checkoutConfig.paypalClientId,
    currency: "EUR",
    intent: "capture",
    components: "buttons"
  });
  script.src = `https://www.paypal.com/sdk/js?${query}`;
  script.async = true;
  paypalSdkPromise = new Promise((resolve, reject) => {
    script.addEventListener("load", () => {
      if (window.paypal) resolve(window.paypal);
      else {
        paypalSdkPromise = null;
        reject(new Error("Le module de paiement PayPal ne s’est pas chargé."));
      }
    }, { once: true });
    script.addEventListener("error", () => {
      paypalSdkPromise = null;
      reject(new Error("PayPal est inaccessible. Vérifiez votre connexion et réessayez."));
    }, { once: true });
    document.head.append(script);
  });
  return paypalSdkPromise;
}

async function initializeCheckout() {
  paymentStatus.textContent = "Connexion à PayPal…";
  try {
    const response = await fetch("/api/config");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Configuration du paiement indisponible.");
    checkoutConfig = result;
    if (!result.paypalConfigured || !result.paypalClientId) {
      paymentStatus.textContent = "PayPal n’est pas encore configuré. Ajoutez PAYPAL_CLIENT_ID et PAYPAL_CLIENT_SECRET au serveur.";
      return;
    }
    const paypal = await loadPaypalSdk();
    const buttons = paypal.Buttons({
      style: { layout: "vertical", shape: "rect", label: "paypal" },
      onClick: (data, actions) => getValidCheckoutDetails() ? actions.resolve() : actions.reject(),
      createOrder: async () => {
        const details = getValidCheckoutDetails();
        if (!details) throw new Error("Complétez le formulaire avant de payer.");
        paymentStatus.textContent = "Préparation de votre paiement sécurisé…";
        return createPaypalOrder(details);
      },
      onApprove: async (data) => {
        if (paymentInProgress) return;
        paymentInProgress = true;
        paymentStatus.textContent = "Confirmation du paiement auprès de PayPal…";
        try {
          const capture = await capturePaypalOrder(data.orderID);
          showOrderConfirmation(pendingCheckoutDetails, capture.id || data.orderID);
          cart = [];
          saveCart();
          renderCart();
          paymentStatus.textContent = "";
        } catch (error) {
          console.error("Impossible de confirmer ou d’enregistrer le paiement.", error);
          paymentStatus.textContent = error instanceof Error
            ? error.message
            : "Le paiement n’a pas pu être confirmé. Votre panier est conservé ; contactez l’atelier.";
        } finally {
          paymentInProgress = false;
        }
      },
      onCancel: () => {
        paymentStatus.textContent = "Paiement annulé. Votre panier est conservé.";
      },
      onError: (error) => {
        console.error("Erreur du paiement PayPal.", error);
        paymentStatus.textContent = error instanceof Error
          ? error.message
          : "Le paiement a échoué. Votre panier est conservé ; réessayez ou contactez l’atelier.";
      }
    });
    if (!buttons.isEligible()) {
      paymentStatus.textContent = "PayPal n’est pas disponible pour ce navigateur ou ce compte.";
      return;
    }
    await buttons.render("#paypal-buttons");
    paymentStatus.textContent = "";
  } catch (error) {
    console.error("Impossible d’initialiser PayPal.", error);
    paymentStatus.textContent = error instanceof Error
      ? error.message
      : "Impossible de charger PayPal. Réessayez plus tard.";
  }
}

document.querySelectorAll(".filter-chip").forEach((button) => {
  button.addEventListener("click", () => {
    activeCategory = button.dataset.category;
    document.querySelector(".filter-chip.active").classList.remove("active");
    button.classList.add("active");
    renderProducts();
  });
});

document.querySelector("#search").addEventListener("input", renderProducts);

productGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-add]");
  if (button) addToCart(button.dataset.add);
});

cartItems.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove]");
  if (removeButton) {
    cart = cart.filter((item) => item.id !== removeButton.dataset.remove);
    saveCart();
    renderCart();
    return;
  }
  const quantityButton = event.target.closest("[data-quantity]");
  if (!quantityButton) return;
  const item = cart.find((entry) => entry.id === quantityButton.dataset.quantity);
  if (!item) return;
  item.quantity += Number(quantityButton.dataset.change);
  if (item.quantity <= 0) cart = cart.filter((entry) => entry !== item);
  if (item.quantity > 20) item.quantity = 20;
  saveCart();
  renderCart();
});

document.querySelector("#open-cart").addEventListener("click", () => setDrawerOpen(true));
document.querySelector("#close-cart").addEventListener("click", () => setDrawerOpen(false));
document.querySelector("#continue-shopping").addEventListener("click", () => setDrawerOpen(false));
overlay.addEventListener("click", () => setDrawerOpen(false));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && cartDrawer.classList.contains("open")) setDrawerOpen(false);
});

document.querySelector("#checkout-button").addEventListener("click", async () => {
  setDrawerOpen(false);
  document.querySelector("#checkout-content").hidden = false;
  document.querySelector("#order-success").hidden = true;
  document.querySelector("#paypal-buttons").replaceChildren();
  checkoutDialog.showModal();
  await initializeCheckout();
});

document.querySelector("#close-checkout").addEventListener("click", () => checkoutDialog.close());
document.querySelector("#finish-order").addEventListener("click", () => checkoutDialog.close());
document.querySelector("#copy-order").addEventListener("click", copyOrderSummary);
checkoutForm.addEventListener("submit", (event) => event.preventDefault());

const dateInput = document.querySelector('input[name="date"]');
const today = new Date();
dateInput.min = new Date(today.getTime() - today.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

renderProducts();
renderCart();
