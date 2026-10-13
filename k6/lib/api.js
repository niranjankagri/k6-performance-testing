// QuickShop API client: one function per endpoint, so tests never build URLs or headers.
//
// Every request gets a `name` tag. k6 groups metrics by URL, and URLs with ids
// (/api/products/7, /api/products/8, ...) would otherwise each become their own series;
// the name tag folds them into one ("GET /api/products/:id"), which is also what the
// thresholds in thresholds.js refer to.

import http from 'k6/http';

import { BASE_URL } from './config.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Request parameters: JSON headers, the Bearer token when given, and the endpoint's name tag. */
function params(name, token) {
  const headers = token ? { ...JSON_HEADERS, Authorization: `Bearer ${token}` } : JSON_HEADERS;
  return { headers, tags: { name } };
}

/** GET /health: status, uptime and server memory. */
export const health = () => http.get(`${BASE_URL}/health`, params('GET /health'));

/** POST /api/auth/login: 200 { token } or 401. */
export const login = (username, password) =>
  http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ username, password }),
    params('POST /api/auth/login'),
  );

/** GET /api/products, optionally one category: 20 products. */
export function listProducts(category) {
  const query = category ? `?category=${category}` : '';
  return http.get(`${BASE_URL}/api/products${query}`, params('GET /api/products'));
}

/** GET /api/products/:id */
export const getProduct = (id) => http.get(`${BASE_URL}/api/products/${id}`, params('GET /api/products/:id'));

/** GET /api/search?q= (the term is URL-encoded: it can contain spaces). */
export const search = (q) =>
  http.get(`${BASE_URL}/api/search?q=${encodeURIComponent(q)}`, params('GET /api/search'));

/** GET /api/cart: the lines and the total. */
export const getCart = (token) => http.get(`${BASE_URL}/api/cart`, params('GET /api/cart', token));

/** POST /api/cart/items: 201 with the updated cart. */
export const addToCart = (token, productId, quantity) =>
  http.post(
    `${BASE_URL}/api/cart/items`,
    JSON.stringify({ productId, quantity }),
    params('POST /api/cart/items', token),
  );

/** DELETE /api/cart: 204. */
export const clearCart = (token) => http.del(`${BASE_URL}/api/cart`, null, params('DELETE /api/cart', token));

/** POST /api/orders: 201 with the order; 409 for an empty cart; 503 when too many orders wait. */
export const placeOrder = (token) =>
  http.post(`${BASE_URL}/api/orders`, null, params('POST /api/orders', token));

/** GET /api/orders/:id: 200, or 404 if it is not the caller's order. */
export const getOrder = (token, id) =>
  http.get(`${BASE_URL}/api/orders/${id}`, params('GET /api/orders/:id', token));
