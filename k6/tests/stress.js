// Stress test: more and more orders per second, in steps, past the expected peak, to find where the
// system stops coping and HOW it fails. It answers "what is our capacity, and do we degrade gracefully
// (slower, but correct) or badly (errors, wrong data)?"
//
//   k6 run k6/tests/stress.js
//
// Checkout needs one of 8 database connections for 60-120 ms, so the theoretical limit is about
// 8 / 0.09 s = 90 orders per second. Below that, response times stay flat; above it, requests queue
// for a connection and checkout time climbs step by step: the "knee" in the response-time chart.
// No pauses between steps (THINK=0): this test is about throughput, not about user behaviour.
//
// History: the first run of this test (MAX_WAITING=0 reproduces it) showed no limit at all: past
// about 90 orders/s every checkout queued, p95 passed 3 s and kept climbing. The app now sheds load:
// when 40 checkouts already wait, new ones get 503 at once. So past the limit some orders are refused,
// but every answer is fast and correct.
//
// The thresholds are not the SLOs: past the limit the SLOs are expected to break. They describe
// graceful degradation instead, and abort the run early if the system really falls over.

import { byProfile } from '../lib/config.js';
import { buy, requireHealthyApp } from '../lib/flows.js';
import { summaryFor } from '../lib/summary.js';

export const options = {
  // Test case ID (docs/manual-test-cases.md) on every metric, so results can be filtered by it
  tags: { testid: 'TC-303' },
  scenarios: {
    rising_orders: {
      executor: 'ramping-arrival-rate',
      exec: 'buying',
      startRate: 0,
      timeUnit: '1s',
      // Steps: below the limit, around it, above it; each step is held to see where it settles
      stages: byProfile({
        ci: [
          { duration: '20s', target: 40 },
          { duration: '30s', target: 40 },
          { duration: '20s', target: 80 },
          { duration: '30s', target: 80 },
          { duration: '20s', target: 120 },
          { duration: '30s', target: 120 },
          { duration: '20s', target: 0 }, // recovery: does it come back to normal?
        ],
        full: [
          { duration: '2m', target: 40 },
          { duration: '5m', target: 40 },
          { duration: '2m', target: 80 },
          { duration: '5m', target: 80 },
          { duration: '2m', target: 120 },
          { duration: '5m', target: 120 },
          { duration: '2m', target: 160 },
          { duration: '5m', target: 160 },
          { duration: '3m', target: 0 },
        ],
      }),
      preAllocatedVUs: 50,
      maxVUs: byProfile({ ci: 300, full: 500 }),
    },
  },
  thresholds: {
    // Every order is either placed with the right total, or refused with 503: never a 500, a timeout
    // or a wrong total
    order_handled: ['rate==1'],
    // Waiting time stays bounded, because the queue is bounded
    checkout_duration: [{ threshold: 'p(95)<1500', abortOnFail: true, delayAbortEval: '20s' }],
    // The rest of the shop (here: adding to the cart) keeps working while checkout is saturated
    'http_req_duration{name:POST /api/cart/items}': ['p(95)<300'],
    // Refused orders are the only expected failures: a few percent of all requests at most
    http_req_failed: [{ threshold: 'rate<0.10', abortOnFail: true, delayAbortEval: '20s' }],
  },
};

/** Runs once before the load starts: stops the test at once if QuickShop is not up. */
export function setup() {
  requireHealthyApp();
}

/** The `rising_orders` scenario's iteration (its `exec`): one order by a logged-in customer. */
export function buying() {
  buy();
}

// End of test: console summary, reports/stress-summary.json and .md (see lib/summary.js)
export const handleSummary = summaryFor('stress', 'TC-303');
