// Soak (endurance) test: normal load for a long time. Problems that need hours to show up: memory
// leaks, growing queues or caches, connections that are never closed, disks that fill with logs,
// response times that creep up. It answers "is the system as fast at hour 8 as at minute 1?"
//
//   k6 run k6/tests/soak.js                  # ci profile: 4 minutes, a short rehearsal
//   k6 run -e PROFILE=full k6/tests/soak.js  # 4 hours
//
// Besides the users, a third scenario reads the server's /health every 10 s and records its memory
// (rssMb) as a custom metric: the chart of server_rss_mb over time is the main result of a soak test.
// Note: QuickShop keeps every order in memory, so its memory does grow with the number of orders;
// the threshold is the budget that growth must stay within.

import { check } from 'k6';
import { Trend } from 'k6/metrics';

import * as api from '../lib/api.js';
import { byProfile } from '../lib/config.js';
import { browse, buy, requireHealthyApp } from '../lib/flows.js';
import { summaryFor } from '../lib/summary.js';
import { SLO } from '../lib/thresholds.js';

const serverMemory = new Trend('server_rss_mb'); // MB, not a time
const DURATION = byProfile({ ci: '4m', full: '4h' });

export const options = {
  scenarios: {
    browsers: {
      executor: 'constant-vus',
      exec: 'browsing',
      vus: byProfile({ ci: 10, full: 100 }),
      duration: DURATION,
    },
    buyers: {
      executor: 'constant-arrival-rate',
      exec: 'buying',
      rate: byProfile({ ci: 2, full: 10 }),
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: byProfile({ ci: 20, full: 100 }),
      maxVUs: byProfile({ ci: 60, full: 300 }),
    },
    server_monitor: {
      executor: 'constant-arrival-rate',
      exec: 'watchServer',
      rate: 1,
      timeUnit: '10s',
      duration: DURATION,
      preAllocatedVUs: 1,
    },
  },
  thresholds: {
    ...SLO,
    dropped_iterations: ['count==0'],
    // Memory budget of the server process for the whole run
    server_rss_mb: [byProfile({ ci: 'max<200', full: 'max<1024' })],
  },
};

export function setup() {
  return { startRssMb: requireHealthyApp().rssMb };
}

export function browsing() {
  browse();
}

export function buying() {
  buy();
}

export function watchServer() {
  const res = api.health();
  if (check(res, { 'health: status 200': (r) => r.status === 200 })) {
    serverMemory.add(res.json('rssMb'));
  }
}

/** Runs once after the test: log how much the server's memory grew during the run. */
export function teardown(data) {
  const res = api.health();
  if (res.status === 200) {
    const { rssMb, orders } = res.json();
    console.log(
      `Server memory: ${data.startRssMb} MB at the start, ${rssMb} MB at the end, ${orders} orders kept`,
    );
  }
}

export const handleSummary = summaryFor('soak');
