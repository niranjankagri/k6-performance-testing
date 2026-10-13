// Smoke test: one user, a short time, every journey. It answers "does the system work under minimal
// load, and do the scripts still match the API?" before any bigger test is worth running.
// Every check must pass and no request may fail: at this load there is no excuse.
//
//   k6 run k6/tests/smoke.js

import { check, fail } from 'k6';

import * as api from '../lib/api.js';
import { byProfile } from '../lib/config.js';
import { browse, buy } from '../lib/flows.js';
import { summaryFor } from '../lib/summary.js';
import { RESPONSE_TIMES } from '../lib/thresholds.js';

export const options = {
  vus: 1,
  duration: byProfile({ ci: '30s', full: '1m' }),
  thresholds: {
    http_req_failed: ['rate==0'],
    checks: ['rate==1'],
    ...RESPONSE_TIMES,
  },
};

/** Runs once before the test: stop at once if the app is not up, instead of 30 s of errors. */
export function setup() {
  const res = api.health();
  if (!check(res, { 'health: status 200': (r) => r.status === 200 })) {
    fail(`QuickShop is not reachable: HTTP ${res.status} ${res.error}`);
  }
}

export default function () {
  browse();
  buy();
}

export const handleSummary = summaryFor('smoke');
