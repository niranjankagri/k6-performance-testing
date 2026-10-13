// Functional tests of the demo API (node --test): the load tests are only meaningful
// if the app answers correctly, so its behaviour is pinned down here first.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { startServer } from './server.js';
import { Pool, TEST_PASSWORD } from './shop.js';

let server;
let base;

before(async () => {
  server = await startServer(0); // a free port
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

/** Sends one request to the test server: JSON body, and the token as a Bearer header when given. */
const call = (method, path, { token, body } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** Logs a test user in and returns the token. */
async function loginAs(username) {
  const res = await call('POST', '/api/auth/login', { body: { username, password: TEST_PASSWORD } });
  return (await res.json()).token;
}

// The fields the soak test reads (rssMb, orders) must be there
test('health check answers ok', async () => {
  const res = await call('GET', '/health');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.ok(body.rssMb > 0 && Number.isInteger(body.orders));
});

test('login returns a token, and refuses a wrong password or missing fields', async () => {
  // A token is a UUID; wrong password 401, missing password 400
  assert.match(await loginAs('user001'), /^[0-9a-f-]{36}$/);
  const wrong = await call('POST', '/api/auth/login', { body: { username: 'user001', password: 'nope' } });
  assert.equal(wrong.status, 401);
  const missing = await call('POST', '/api/auth/login', { body: { username: 'user001' } });
  assert.equal(missing.status, 400);
});

test('products: list, filter by category, get one, 404 for an unknown id', async () => {
  // limit, category filter, one product, unknown id
  const all = await (await call('GET', '/api/products?limit=50')).json();
  assert.equal(all.length, 50);
  const books = await (await call('GET', '/api/products?category=books')).json();
  assert.ok(books.length > 0 && books.every((p) => p.category === 'books'));
  assert.equal((await (await call('GET', '/api/products/7')).json()).id, 7);
  assert.equal((await call('GET', '/api/products/999')).status, 404);
});

test('search finds matching names and needs at least 2 characters', async () => {
  // Every hit contains the term; a one-letter query is refused
  const found = await (await call('GET', '/api/search?q=garden')).json();
  assert.ok(found.length > 0 && found.every((p) => p.name.includes('garden')));
  assert.equal((await call('GET', '/api/search?q=g')).status, 400);
});

test('cart and orders need a token', async () => {
  // No token at all, and a token the server never issued
  assert.equal((await call('GET', '/api/cart')).status, 401);
  assert.equal((await call('POST', '/api/orders', { token: 'not-a-token' })).status, 401);
});

test('add to cart, check out, read the order; the cart is empty afterwards', async () => {
  // Arrange: an empty cart (the server is shared by all tests in this file)
  const token = await loginAs('user002');
  await call('DELETE', '/api/cart', { token });
  // Add 2 of product 3: the cart shows the line and its total
  const added = await call('POST', '/api/cart/items', { token, body: { productId: 3, quantity: 2 } });
  assert.equal(added.status, 201);
  const cart = await added.json();
  assert.equal(cart.items[0].quantity, 2);

  // Check out: the order keeps the cart's total
  const placed = await call('POST', '/api/orders', { token });
  assert.equal(placed.status, 201);
  const order = await placed.json();
  assert.equal(order.total, cart.total);

  // The order can be read back, and the cart is empty again
  assert.equal((await call('GET', `/api/orders/${order.id}`, { token })).status, 200);
  assert.deepEqual(await (await call('GET', '/api/cart', { token })).json(), { items: [], total: 0 });
});

test('cart validation: bad quantity 400, unknown product 404, empty cart cannot be ordered', async () => {
  // Arrange: an empty cart
  const token = await loginAs('user003');
  await call('DELETE', '/api/cart', { token });
  // Quantity below 1, a product that does not exist, then an order with nothing in the cart
  const bad = await call('POST', '/api/cart/items', { token, body: { productId: 3, quantity: 0 } });
  assert.equal(bad.status, 400);
  const unknown = await call('POST', '/api/cart/items', { token, body: { productId: 999, quantity: 1 } });
  assert.equal(unknown.status, 404);
  assert.equal((await call('POST', '/api/orders', { token })).status, 409);
});

test("a user cannot read another user's order", async () => {
  // Arrange: user004 places an order
  const owner = await loginAs('user004');
  await call('POST', '/api/cart/items', { token: owner, body: { productId: 1, quantity: 1 } });
  const order = await (await call('POST', '/api/orders', { token: owner })).json();
  // user005 asks for it: 404, not 403, so the id is not even confirmed to exist
  const other = await loginAs('user005');
  assert.equal((await call('GET', `/api/orders/${order.id}`, { token: other })).status, 404);
});

test('the pool lets at most `size` holders in and hands slots over in order', async () => {
  // Arrange: a pool of 2, both slots taken
  const pool = new Pool(2);
  await pool.acquire();
  await pool.acquire();
  // Two more wait in line
  const order = [];
  const third = pool.acquire().then(() => order.push('third'));
  const fourth = pool.acquire().then(() => order.push('fourth'));
  assert.equal(pool.queue.length, 2);
  // Both holders release: the slots go to the waiting ones in arrival order, not back to free
  pool.release();
  pool.release();
  await Promise.all([third, fourth]);
  assert.deepEqual(order, ['third', 'fourth']);
  assert.equal(pool.inUse, 2);
});

test('checkout sheds load: with the queue full, new orders get 503 at once instead of waiting', async () => {
  // 60 users with a product in the cart check out at the same moment: 8 run, 40 wait, the rest are refused
  const tokens = await Promise.all(
    Array.from({ length: 60 }, async (_, i) => {
      const token = await loginAs(`user${String(100 + i).padStart(3, '0')}`);
      await call('DELETE', '/api/cart', { token });
      await call('POST', '/api/cart/items', { token, body: { productId: 1, quantity: 1 } });
      return token;
    }),
  );
  // Every order is either placed (201) or refused at once (503): nothing else, and some are refused
  const statuses = await Promise.all(
    tokens.map(async (token) => (await call('POST', '/api/orders', { token })).status),
  );
  const refused = statuses.filter((s) => s === 503).length;
  assert.equal(statuses.filter((s) => s === 201).length + refused, 60);
  assert.ok(refused > 0, 'some orders should be refused');
});
