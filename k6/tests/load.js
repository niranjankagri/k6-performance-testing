// Load test: the expected busy-day traffic, with both kinds of users at once, checked against the SLOs.
// It answers "does the system meet its response-time and error targets under normal peak load?"
//
//   k6 run k6/tests/load.js                  # ci profile: about 2 minutes
//   k6 run -e PROFILE=full k6/tests/load.js  # 20 minutes, 10x the users
//
// Two scenarios run in parallel, each with its own executor (the "workload model"):
//   browsers - visitors, closed model (ramping-vus): a fixed number of users, each starts the next
//              visit when the last one ends. If the app slows down, fewer visits happen, as in real life
//              for a limited audience.
//   buyers   - customers, open model (constant-arrival-rate): new orders ARRIVE at a fixed rate, however
//              slow the app is. Slowness then shows as more parallel users, not as fewer orders, which is
//              how traffic from the internet behaves. k6 starts extra VUs as needed (up to maxVUs).

import { byProfile } from '../lib/config.js';
import { browse, buy, requireHealthyApp } from '../lib/flows.js';
import { summaryFor } from '../lib/summary.js';
import { SLO } from '../lib/thresholds.js';

export const options = {
  // Test case ID (docs/manual-test-cases.md) on every metric, so results can be filtered by it
  tags: { testid: 'TC-302' },
  scenarios: {
    browsers: {
      executor: 'ramping-vus',
      exec: 'browsing',
      startVUs: 0,
      stages: byProfile({
        ci: [
          { duration: '20s', target: 20 }, // ramp up
          { duration: '1m20s', target: 20 }, // steady
          { duration: '20s', target: 0 }, // ramp down
        ],
        full: [
          { duration: '3m', target: 200 },
          { duration: '15m', target: 200 },
          { duration: '2m', target: 0 },
        ],
      }),
      gracefulRampDown: '10s',
    },
    buyers: {
      executor: 'constant-arrival-rate',
      exec: 'buying',
      rate: byProfile({ ci: 2, full: 20 }), // orders started per timeUnit
      timeUnit: '1s',
      duration: byProfile({ ci: '2m', full: '20m' }),
      // A buy journey lasts about 8 s with think time: rate x 8 VUs are busy at once
      preAllocatedVUs: byProfile({ ci: 20, full: 200 }),
      maxVUs: byProfile({ ci: 60, full: 500 }),
    },
  },
  thresholds: {
    ...SLO,
    // An open model that runs out of VUs silently starts fewer iterations: make that visible
    dropped_iterations: ['count==0'],
  },
};

/** Runs once before the load starts: stops the test at once if QuickShop is not up. */
export function setup() {
  requireHealthyApp();
}

/** The `browsers` scenario's iteration (its `exec`): one visit of an anonymous visitor. */
export function browsing() {
  browse();
}

/** The `buyers` scenario's iteration (its `exec`): one order by a logged-in customer. */
export function buying() {
  buy();
}

// End of test: console summary, reports/load-summary.json and .md (see lib/summary.js)
export const handleSummary = summaryFor('load', 'TC-302');
