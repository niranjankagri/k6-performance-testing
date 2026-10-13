// Service level objectives (SLOs) as k6 thresholds. A threshold that is not met makes k6 exit with
// code 99, which fails the CI job: the performance requirement is a test, not a chart to look at.
//
// Response-time limits are per endpoint (the `name` tag from api.js): one global p95 would let a
// fast endpoint hide a slow one. The numbers follow what each endpoint does: reads are cheap,
// search scores every product, checkout waits for a database connection.

export const ERROR_RATE = {
  http_req_failed: ['rate<0.01'], // less than 1% of requests fail (4xx/5xx or no answer)
  checks: ['rate>0.99'], // more than 99% of the functional checks pass
};

export const RESPONSE_TIMES = {
  'http_req_duration{name:GET /api/products}': ['p(95)<200'],
  'http_req_duration{name:GET /api/products/:id}': ['p(95)<150'],
  'http_req_duration{name:GET /api/search}': ['p(95)<300'],
  'http_req_duration{name:POST /api/auth/login}': ['p(95)<250'],
  'http_req_duration{name:POST /api/cart/items}': ['p(95)<200'],
  checkout_duration: ['p(95)<400', 'p(99)<600'],
};

export const BUSINESS = {
  order_success: ['rate>0.99'],
};

/** The full set, for load and soak tests. */
export const SLO = { ...ERROR_RATE, ...RESPONSE_TIMES, ...BUSINESS };
