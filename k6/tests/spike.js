// Spike test: traffic jumps from quiet to many times normal within seconds (a newsletter, a TV ad,
// a sale at 09:00), stays there briefly, then drops. It answers "do we survive a sudden burst, and do we
// recover afterwards, or stay slow or broken once it is over?"
//
//   k6 run k6/tests/spike.js
//
// Visitors spike (closed model, ramping-vus) while orders keep arriving at their normal rate, so the
// spike's effect on the customers who want to pay is visible on its own.

import { byProfile } from '../lib/config.js';
import { browse, buy, requireHealthyApp } from '../lib/flows.js';
import { summaryFor } from '../lib/summary.js';

export const options = {
  scenarios: {
    visitor_spike: {
      executor: 'ramping-vus',
      exec: 'browsing',
      startVUs: 5,
      stages: byProfile({
        ci: [
          { duration: '20s', target: 5 }, // quiet: the baseline
          { duration: '10s', target: 150 }, // the spike: 30x within 10 s
          { duration: '40s', target: 150 },
          { duration: '10s', target: 5 }, // gone again
          { duration: '30s', target: 5 }, // recovery: back to baseline response times?
        ],
        full: [
          { duration: '2m', target: 20 },
          { duration: '30s', target: 600 },
          { duration: '5m', target: 600 },
          { duration: '30s', target: 20 },
          { duration: '5m', target: 20 },
        ],
      }),
      gracefulRampDown: '10s',
    },
    steady_orders: {
      executor: 'constant-arrival-rate',
      exec: 'buying',
      rate: byProfile({ ci: 2, full: 10 }),
      timeUnit: '1s',
      duration: byProfile({ ci: '1m50s', full: '13m' }),
      preAllocatedVUs: byProfile({ ci: 20, full: 100 }),
      maxVUs: byProfile({ ci: 60, full: 300 }),
    },
  },
  thresholds: {
    // Survive: almost no errors during the whole test, spike included
    http_req_failed: ['rate<0.02'],
    checks: ['rate>0.98'],
    order_handled: ['rate==1'],
    // Slower during the spike is acceptable, but within limits (looser than the load-test SLOs)
    'http_req_duration{name:GET /api/products}': ['p(95)<500'],
    'http_req_duration{name:GET /api/search}': ['p(95)<800'],
    // Customers paying during the spike must not notice much
    checkout_duration: ['p(95)<600'],
  },
};

/** Runs once before the load starts: stops the test at once if QuickShop is not up. */
export function setup() {
  requireHealthyApp();
}

/** The `visitor_spike` scenario's iteration (its `exec`): one visit of an anonymous visitor. */
export function browsing() {
  browse();
}

/** The `steady_orders` scenario's iteration (its `exec`): one order by a logged-in customer. */
export function buying() {
  buy();
}

// End of test: console summary, reports/spike-summary.json and .md (see lib/summary.js)
export const handleSummary = summaryFor('spike');
