// In-memory data and business rules of the demo shop: users, products, carts and orders.
// No database: the "database pool" below only limits how many checkouts run at once,
// which gives the app a real, measurable bottleneck for the stress tests to find.

import { randomUUID } from 'node:crypto';

// 50 products in 5 categories, with stable ids 1..50
const CATEGORIES = ['books', 'games', 'garden', 'kitchen', 'music'];
export const products = Array.from({ length: 50 }, (_, i) => ({
  id: i + 1,
  name: `${CATEGORIES[i % 5]} item ${String(i + 1).padStart(2, '0')}`,
  category: CATEGORIES[i % 5],
  price: Math.round((5 + ((i * 7) % 95) + 0.99) * 100) / 100,
  stock: 1_000_000,
}));

// Test users user001..user500, all with the same published test password (see data/users.csv)
export const TEST_PASSWORD = 'Perf-Test-1';
const users = new Map(
  Array.from({ length: 500 }, (_, i) => {
    const username = `user${String(i + 1).padStart(3, '0')}`;
    return [username, { username, password: TEST_PASSWORD }];
  }),
);

const tokens = new Map(); // token -> username
const carts = new Map(); // username -> Map(productId -> quantity)
const orders = new Map(); // order id -> order

/** Wait for a while: every endpoint has a small, realistic random latency. */
export const delay = (min, max) =>
  new Promise((resolve) => setTimeout(resolve, min + Math.random() * (max - min)));

/** A counting semaphore: at most `size` holders, the rest wait in a FIFO queue. */
export class Pool {
  constructor(size) {
    this.size = size;
    this.inUse = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.inUse < this.size) {
      this.inUse++;
      return;
    }
    // Wait until a holder releases its slot to us
    await new Promise((resolve) => this.queue.push(resolve));
  }

  release() {
    const next = this.queue.shift();
    if (next) next();
    else this.inUse--;
  }
}

export function login(username, password) {
  const user = users.get(username);
  if (!user || user.password !== password) return null;
  const token = randomUUID();
  tokens.set(token, username);
  return token;
}

export const userForToken = (token) => tokens.get(token);

export function listProducts({ category, limit }) {
  const found = category ? products.filter((p) => p.category === category) : products;
  return found.slice(0, limit);
}

export const findProduct = (id) => products.find((p) => p.id === id);

/** Full-text search over the names: deliberately the most expensive read (scores and sorts everything). */
export function search(query) {
  const q = query.toLowerCase();
  return products
    .map((p) => ({ p, score: p.name.toLowerCase().includes(q) ? q.length / p.name.length : 0 }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.p);
}

export function cartOf(username) {
  if (!carts.has(username)) carts.set(username, new Map());
  return carts.get(username);
}

/** The cart as the API returns it: lines with prices and the total. */
export function cartView(username) {
  const items = [...cartOf(username)].map(([productId, quantity]) => {
    const product = findProduct(productId);
    return { productId, name: product.name, price: product.price, quantity };
  });
  const total = Math.round(items.reduce((sum, i) => sum + i.price * i.quantity, 0) * 100) / 100;
  return { items, total };
}

export function placeOrder(username) {
  const view = cartView(username);
  const order = { id: randomUUID(), username, ...view, createdAt: new Date().toISOString() };
  orders.set(order.id, order);
  carts.delete(username);
  return order;
}

export const findOrder = (id) => orders.get(id);

/** Orders are kept in memory for the life of the process (the soak test shows what that costs). */
export const orderCount = () => orders.size;
