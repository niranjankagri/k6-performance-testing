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
// The thresholds are not the SLOs: past the limit the SLOs are expected to break. They describe
// graceful degradation instead, and abort the run early if the system really falls over.

import { byProfile } from '../lib/config.js';
import { buy, requireHealthyApp } from '../lib/flows.js';
import { summaryFor } from '../lib/summary.js';

export const options = {
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
    // Graceful: still almost no errors, every accepted order is correct
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '20s' }],
    order_success: ['rate>0.95'],
    // Slower is allowed, but not unbounded
    checkout_duration: [{ threshold: 'p(95)<3000', abortOnFail: true, delayAbortEval: '20s' }],
  },
};

export function setup() {
  requireHealthyApp();
}

export function buying() {
  buy();
}

export const handleSummary = summaryFor('stress');
