// User journeys: what one virtual user (VU) does in one iteration. Tests choose the journeys and
// the load; the steps, checks and custom metrics live here, once.
//
//   browse() - an anonymous visitor: product list, a category, a product, a search
//   buy()    - a logged-in customer: clear cart, add 1-3 products, view cart, order, read the order

import { check, fail, group, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

import * as api from './api.js';
import { THINK } from './config.js';
import { CATEGORIES, PRODUCT_COUNT, randomInt, randomItem, SEARCH_TERMS, userForVu } from './data.js';

// Business metrics, next to k6's built-in http_* metrics
export const checkoutDuration = new Trend('checkout_duration', true); // true = a time, shown in ms
export const ordersPlaced = new Counter('orders_placed');
export const orderSuccess = new Rate('order_success');
// Overload: the shop refuses orders with 503 when too many already wait for the database
export const ordersRefused = new Counter('orders_refused');
// true when the order was placed correctly OR politely refused (503); false on anything else
// (500, timeout, wrong total). The stress test needs this to be 100%: slow or busy is fine, wrong is not.
export const orderHandled = new Rate('order_handled');

/** For setup(): stop at once if the app is not up, instead of minutes of connection errors. */
export function requireHealthyApp() {
  const res = api.health();
  if (!check(res, { 'health: status 200': (r) => r.status === 200 })) {
    fail(`QuickShop is not reachable at its BASE_URL: HTTP ${res.status} ${res.error}`);
  }
  return res.json();
}

/** A pause like a real user reading the page: 1-3 s, scaled with THINK (0 in a pure throughput test). */
export function think(min = 1, max = 3) {
  if (THINK > 0) sleep((min + Math.random() * (max - min)) * THINK);
}

/** An anonymous visitor: product list, one category, one product, one search, with pauses in between. */
export function browse() {
  group('browse', () => {
    // The home page: the first 20 products
    const list = api.listProducts();
    check(list, {
      'products: status 200': (r) => r.status === 200,
      'products: 20 returned': (r) => r.json().length === 20,
    });
    think();

    // A category page: every product shown must be of that category
    const category = randomItem(CATEGORIES);
    check(api.listProducts(category), {
      'category: only that category': (r) =>
        r.status === 200 && r.json().every((p) => p.category === category),
    });
    think();

    // A product page: the product asked for, not another one
    const id = randomInt(1, PRODUCT_COUNT);
    check(api.getProduct(id), {
      'product: status 200': (r) => r.status === 200,
      'product: right id': (r) => r.json('id') === id,
    });
    think();

    // A search with a term that always has hits
    check(api.search(randomItem(SEARCH_TERMS)), {
      'search: status 200': (r) => r.status === 200,
      'search: found something': (r) => r.json().length > 0,
    });
    think();
  });
}

// Each VU runs in its own JavaScript runtime, so this variable is per VU: every VU logs in once
// and reuses its token, the way a real user's session lasts for many page views.
let token;

/** Logs this VU's user in on its first call and returns the token; later calls reuse it. */
function ensureLoggedIn() {
  if (token) return token;
  const user = userForVu(__VU);
  const res = api.login(user.username, user.password);
  const ok = check(res, {
    'login: status 200': (r) => r.status === 200,
    'login: token returned': (r) => typeof r.json('token') === 'string',
  });
  // Without a token the rest of the journey is meaningless: end this iteration (counted as failed)
  if (!ok) fail(`login failed for ${user.username}: HTTP ${res.status}`);
  token = res.json('token');
  return token;
}

/**
 * A logged-in customer places one order: clear the cart, add 1-3 products, read the cart, check out,
 * read the order back. Records the checkout time and whether the order was placed, refused or failed.
 */
export function buy() {
  group('buy', () => {
    const auth = ensureLoggedIn();
    // A previous iteration may have stopped half-way (for example at the end of a test): start clean
    api.clearCart(auth);

    // 1-3 add-to-cart steps, each with a random product and 1-3 items
    const lines = randomInt(1, 3);
    for (let i = 0; i < lines; i++) {
      check(api.addToCart(auth, randomInt(1, PRODUCT_COUNT), randomInt(1, 3)), {
        'add to cart: status 201': (r) => r.status === 201,
      });
      think(0.5, 1.5);
    }

    // The cart page: its total is what the order must charge
    const cart = api.getCart(auth);
    check(cart, {
      'cart: all lines there': (r) => r.status === 200 && r.json('items').length > 0,
    });
    think();

    // Checkout: the step the SLOs watch most closely
    const order = api.placeOrder(auth);
    checkoutDuration.add(order.timings.duration);
    const placed = check(order, {
      'order: status 201': (r) => r.status === 201,
      'order: total matches the cart': (r) => r.status === 201 && r.json('total') === cart.json('total'),
    });
    orderSuccess.add(placed);
    const refused = order.status === 503;
    if (refused) ordersRefused.add(1);
    orderHandled.add(placed || refused);
    if (!placed) return;
    ordersPlaced.add(1);

    // The order confirmation page
    check(api.getOrder(auth, order.json('id')), {
      'order details: status 200': (r) => r.status === 200,
    });
    think();
  });
}
