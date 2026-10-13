// QuickShop: the demo REST API that the k6 tests load. Plain Node, no dependencies.
//
//   node app/server.js                         # http://localhost:3000
//   PORT=4000 node app/server.js               # another port
//   CHECKOUT_DELAY_MS=300 node app/server.js   # simulate a slow release: checkout 300 ms slower
//   DB_POOL_SIZE=4 node app/server.js          # a smaller "database pool": saturates sooner
//   MAX_WAITING=0 node app/server.js           # no load shedding: checkouts queue without limit
//
// Endpoints (JSON in and out; the cart and orders need "Authorization: Bearer <token>"):
//   GET    /health                -> { status, uptimeSeconds, rssMb, orders } (the soak test watches rssMb)
//   POST   /api/auth/login        { username, password }  -> 200 { token } | 400 | 401
//   GET    /api/products          ?category=&limit=
//   GET    /api/products/:id
//   GET    /api/search            ?q=
//   GET    /api/cart
//   POST   /api/cart/items        { productId, quantity } -> 201 cart | 400 | 404
//   DELETE /api/cart              -> 204
//   POST   /api/orders            -> 201 order | 409 (empty cart) | 503 (too busy, try again)
//   GET    /api/orders/:id        -> 200 | 404 (unknown, or another user's order)

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import * as shop from './shop.js';

const CHECKOUT_DELAY_MS = Number(process.env.CHECKOUT_DELAY_MS ?? 0);
const dbPool = new shop.Pool(Number(process.env.DB_POOL_SIZE ?? 8));
// Load shedding: with more checkouts than this already waiting for a connection, refuse new ones at
// once (503) instead of letting the queue, and every customer's wait, grow without limit.
// Found by the stress test; 0 switches it off to reproduce the original behaviour.
const MAX_WAITING = Number(process.env.MAX_WAITING ?? 40);

/** Writes a JSON response (an empty body for 204). */
const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

/** Reads the request body as JSON: {} when empty, null when it is not valid JSON (the routes answer 400). */
async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** The logged-in user of the request, or undefined. */
function authUser(req) {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? shop.userForToken(header.slice(7)) : undefined;
}

/**
 * Routes one request: matches method + path in the order of the endpoint list at the top of the file.
 * Most routes wait a short random time (shop.delay) to behave like a real service with a database.
 */
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  const method = req.method;

  // Health: no login, no delay; reports memory and order count for the soak test
  if (method === 'GET' && path === '/health') {
    return send(res, 200, {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      // Memory of the server process: a soak test watches it grow (or not) over hours
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      orders: shop.orderCount(),
    });
  }

  // Login: both fields required (400), wrong credentials 401
  if (method === 'POST' && path === '/api/auth/login') {
    const body = await readJson(req);
    if (!body?.username || !body?.password)
      return send(res, 400, { error: 'username and password are required' });
    await shop.delay(15, 35); // password hashing takes a moment
    const token = shop.login(body.username, body.password);
    return token ? send(res, 200, { token }) : send(res, 401, { error: 'invalid username or password' });
  }

  // Product list, optional ?category=, at most 50
  if (method === 'GET' && path === '/api/products') {
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 20), 50);
    await shop.delay(10, 30);
    return send(res, 200, shop.listProducts({ category: url.searchParams.get('category'), limit }));
  }

  // One product by numeric id
  const productMatch = path.match(/^\/api\/products\/(\d+)$/);
  if (method === 'GET' && productMatch) {
    await shop.delay(5, 15);
    const product = shop.findProduct(Number(productMatch[1]));
    return product ? send(res, 200, product) : send(res, 404, { error: 'product not found' });
  }

  // Search: q needs at least 2 characters
  if (method === 'GET' && path === '/api/search') {
    const q = url.searchParams.get('q') ?? '';
    if (q.length < 2) return send(res, 400, { error: 'q needs at least 2 characters' });
    await shop.delay(40, 90); // the slowest read: full-text search
    return send(res, 200, shop.search(q));
  }

  // Everything below needs a logged-in user
  if (path.startsWith('/api/cart') || path.startsWith('/api/orders')) {
    const user = authUser(req);
    if (!user) return send(res, 401, { error: 'missing or invalid token' });

    // Read the cart
    if (method === 'GET' && path === '/api/cart') {
      await shop.delay(5, 15);
      return send(res, 200, shop.cartView(user));
    }

    // Add a product to the cart: integer productId, quantity 1-10
    if (method === 'POST' && path === '/api/cart/items') {
      const body = await readJson(req);
      const quantity = body?.quantity;
      if (
        !Number.isInteger(body?.productId) ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 10
      ) {
        return send(res, 400, { error: 'productId and quantity (1-10) are required' });
      }
      if (!shop.findProduct(body.productId)) return send(res, 404, { error: 'product not found' });
      await shop.delay(10, 25);
      const cart = shop.cartOf(user);
      cart.set(body.productId, (cart.get(body.productId) ?? 0) + quantity);
      return send(res, 201, shop.cartView(user));
    }

    // Empty the cart
    if (method === 'DELETE' && path === '/api/cart') {
      shop.cartOf(user).clear();
      return send(res, 204);
    }

    // Check out: needs a non-empty cart and a free database connection
    if (method === 'POST' && path === '/api/orders') {
      if (shop.cartOf(user).size === 0) return send(res, 409, { error: 'the cart is empty' });
      // The bottleneck: every checkout needs one of the few database connections
      if (MAX_WAITING > 0 && dbPool.queue.length >= MAX_WAITING) {
        res.setHeader('Retry-After', '1');
        return send(res, 503, { error: 'too many orders right now, try again in a second' });
      }
      await dbPool.acquire();
      try {
        await shop.delay(60 + CHECKOUT_DELAY_MS, 120 + CHECKOUT_DELAY_MS);
        return send(res, 201, shop.placeOrder(user));
      } finally {
        dbPool.release();
      }
    }

    // Read one of your own orders
    const orderMatch = path.match(/^\/api\/orders\/([\w-]+)$/);
    if (method === 'GET' && orderMatch) {
      await shop.delay(10, 20);
      const order = shop.findOrder(orderMatch[1]);
      // Another user's order is reported as not found: no hint that the id exists
      return order && order.username === user
        ? send(res, 200, order)
        : send(res, 404, { error: 'order not found' });
    }
  }

  return send(res, 404, { error: 'not found' });
}

/**
 * Starts the HTTP server and resolves once it listens. Port 0 picks a free port (used by the tests).
 * An unexpected error in a route becomes a 500 instead of crashing the process.
 */
export function startServer(port = Number(process.env.PORT ?? 3000)) {
  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      console.error(error);
      send(res, 500, { error: 'internal error' });
    });
  });
  // Keep connections open between requests, like a real server behind a load balancer
  server.keepAliveTimeout = 65_000;
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

// Started directly (node app/server.js), not imported by the tests
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startServer();
  console.log(`QuickShop API listening on http://localhost:${server.address().port}`);
}
