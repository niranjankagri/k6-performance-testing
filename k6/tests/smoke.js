// Smoke test: one user, a short time, every journey. It answers "does the system work under minimal
// load, and do the scripts still match the API?" before any bigger test is worth running.
// Every check must pass and no request may fail: at this load there is no excuse.
//
//   k6 run k6/tests/smoke.js

import { byProfile } from '../lib/config.js';
import { browse, buy, requireHealthyApp } from '../lib/flows.js';
import { summaryFor } from '../lib/summary.js';
import { RESPONSE_TIMES } from '../lib/thresholds.js';

export const options = {
  // Test case ID (docs/manual-test-cases.md) on every metric, so results can be filtered by it
  tags: { testid: 'TC-301' },
  vus: 1,
  duration: byProfile({ ci: '30s', full: '1m' }),
  thresholds: {
    http_req_failed: ['rate==0'],
    checks: ['rate==1'],
    ...RESPONSE_TIMES,
  },
};

/** Runs once before the load starts: stops the test at once if QuickShop is not up. */
export function setup() {
  requireHealthyApp();
}

/** One iteration of the single VU: a visit, then an order. */
export default function () {
  browse();
  buy();
}

// End of test: console summary, reports/smoke-summary.json and .md (see lib/summary.js)
export const handleSummary = summaryFor('smoke', 'TC-301');
