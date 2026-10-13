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

const call = (method, path, { token, body } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function loginAs(username) {
  const res = await call('POST', '/api/auth/login', { body: { username, password: TEST_PASSWORD } });
  return (await res.json()).token;
}

test('health check answers ok', async () => {
  const res = await call('GET', '/health');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.ok(body.rssMb > 0 && Number.isInteger(body.orders));
});

test('login returns a token, and refuses a wrong password or missing fields', async () => {
  assert.match(await loginAs('user001'), /^[0-9a-f-]{36}$/);
  const wrong = await call('POST', '/api/auth/login', { body: { username: 'user001', password: 'nope' } });
  assert.equal(wrong.status, 401);
  const missing = await call('POST', '/api/auth/login', { body: { username: 'user001' } });
  assert.equal(missing.status, 400);
});

test('products: list, filter by category, get one, 404 for an unknown id', async () => {
  const all = await (await call('GET', '/api/products?limit=50')).json();
  assert.equal(all.length, 50);
  const books = await (await call('GET', '/api/products?category=books')).json();
  assert.ok(books.length > 0 && books.every((p) => p.category === 'books'));
  assert.equal((await (await call('GET', '/api/products/7')).json()).id, 7);
  assert.equal((await call('GET', '/api/products/999')).status, 404);
});

test('search finds matching names and needs at least 2 characters', async () => {
  const found = await (await call('GET', '/api/search?q=garden')).json();
  assert.ok(found.length > 0 && found.every((p) => p.name.includes('garden')));
  assert.equal((await call('GET', '/api/search?q=g')).status, 400);
});

test('cart and orders need a token', async () => {
  assert.equal((await call('GET', '/api/cart')).status, 401);
  assert.equal((await call('POST', '/api/orders', { token: 'not-a-token' })).status, 401);
});

test('add to cart, check out, read the order; the cart is empty afterwards', async () => {
  const token = await loginAs('user002');
  await call('DELETE', '/api/cart', { token });
  const added = await call('POST', '/api/cart/items', { token, body: { productId: 3, quantity: 2 } });
  assert.equal(added.status, 201);
  const cart = await added.json();
  assert.equal(cart.items[0].quantity, 2);

  const placed = await call('POST', '/api/orders', { token });
  assert.equal(placed.status, 201);
  const order = await placed.json();
  assert.equal(order.total, cart.total);

  assert.equal((await call('GET', `/api/orders/${order.id}`, { token })).status, 200);
  assert.deepEqual(await (await call('GET', '/api/cart', { token })).json(), { items: [], total: 0 });
});

test('cart validation: bad quantity 400, unknown product 404, empty cart cannot be ordered', async () => {
  const token = await loginAs('user003');
  await call('DELETE', '/api/cart', { token });
  const bad = await call('POST', '/api/cart/items', { token, body: { productId: 3, quantity: 0 } });
  assert.equal(bad.status, 400);
  const unknown = await call('POST', '/api/cart/items', { token, body: { productId: 999, quantity: 1 } });
  assert.equal(unknown.status, 404);
  assert.equal((await call('POST', '/api/orders', { token })).status, 409);
});

test("a user cannot read another user's order", async () => {
  const owner = await loginAs('user004');
  await call('POST', '/api/cart/items', { token: owner, body: { productId: 1, quantity: 1 } });
  const order = await (await call('POST', '/api/orders', { token: owner })).json();
  const other = await loginAs('user005');
  assert.equal((await call('GET', `/api/orders/${order.id}`, { token: other })).status, 404);
});

test('the pool lets at most `size` holders in and hands slots over in order', async () => {
  const pool = new Pool(2);
  await pool.acquire();
  await pool.acquire();
  const order = [];
  const third = pool.acquire().then(() => order.push('third'));
  const fourth = pool.acquire().then(() => order.push('fourth'));
  assert.equal(pool.queue.length, 2);
  pool.release();
  pool.release();
  await Promise.all([third, fourth]);
  assert.deepEqual(order, ['third', 'fourth']);
  assert.equal(pool.inUse, 2);
});
