# Design decisions

Why the project is built this way, and what was considered instead.

## 1. The system under test lives in the repository

Load tests against a public demo site would put real load on a server someone else pays for, and the results would
depend on that site's day. So QuickShop is part of the repository: a small Node API with realistic latencies and one
real bottleneck (a pool of 8 "database connections" at checkout). Every CI job starts its own copy. As a result:

- the tests can push the app past its limit without harming anyone;
- the numbers are repeatable, because they depend only on this code (and on the runner);
- the app can be changed on purpose: `CHECKOUT_DELAY_MS` simulates a slow release and `MAX_WAITING=0` brings back
  the original queueing, so the tests can be shown to catch both.

`app/server.test.js` pins down the app's functional behaviour first. A load test of wrong answers is worthless, and the
k6 checks are not a replacement for functional tests.

## 2. One test type per question

| Test | Question |
|---|---|
| smoke | do the system and the scripts work at all? (the gate for everything else) |
| load | does the expected peak meet the SLOs? |
| stress | where is the limit, and does the system fail gracefully past it? |
| spike | does a sudden burst break it, and does it recover? |
| soak | does anything degrade over hours (memory, queues, response times)? |

Each test has its own thresholds, because "passing" means something different in each one. A stress test that
applied the load-test SLOs would always fail, by design. Its thresholds describe *graceful* degradation instead.

## 3. Thresholds are the pass/fail criteria (SLOs as code)

A chart that someone has to look at is not a test. The SLOs are k6 thresholds (`k6/lib/thresholds.js`). When one is
missed, k6 exits with code 99, the CI job fails, and the Markdown summary shows which threshold failed and by how much.

- **Per endpoint, not global.** A single global p95 mixes 15 ms product reads with 100 ms checkouts. A slow checkout
  could then hide behind thousands of fast reads. Every request carries a stable `name` tag, and each endpoint has its
  own threshold.
- **Percentiles, not averages.** An average hides the slow tail that users actually notice. p95 is the main limit,
  and p99 is added for checkout.
- **Error rate and checks as well.** A fast error is not a success: `http_req_failed` < 1% and `checks` > 99%.
- **Business metrics.** `order_success`, `orders_placed`, and in the stress test `order_handled` (placed correctly
  OR politely refused with 503) state the outcome in the shop's own terms.
- **`abortOnFail`** in the stress test stops a run that is clearly broken, instead of hammering a dead system for
  minutes. `delayAbortEval` gives the metrics time to settle first.

## 4. Workload models: closed and open, side by side

- **Closed model** (`ramping-vus`, `constant-vus`): a fixed number of users, each starting the next iteration when the
  last one ended. If the system slows down, the load drops on its own. This suits a limited audience, such as visitors
  browsing.
- **Open model** (`constant-arrival-rate`, `ramping-arrival-rate`): new iterations *arrive* at a set rate, whatever
  the response time. This is how internet traffic behaves, and it is the only way to measure "can we handle N orders
  per second". If the app slows down, k6 needs more VUs; `maxVUs` caps them, and `dropped_iterations` (with a
  threshold) shows when even that was not enough.

The load, spike and soak tests run both models at once: visitors in a closed model, orders in an open one. The stress
test uses only the open model, because its question is about throughput.

## 5. Realistic users

- **Think time** (1-3 s between steps) makes a VU behave like a person. Without it, 20 VUs would make as many requests
  as hundreds of real users. `THINK=0` turns it off for the throughput-focused stress test.
- **One login per VU.** The token is kept in a module-level variable; each VU has its own JavaScript runtime, so the
  variable belongs to that VU. Real sessions last many page views, and a login per iteration would load the login
  endpoint unrealistically.
- **Different users per VU** from `users.csv` (`SharedArray`: parsed once, shared read-only by all VUs). Parallel VUs
  never share a cart.
- **Clean start.** `buy()` clears the cart first, because an iteration cut off at the end of a stage can leave items
  behind.

## 6. Layers

```
tests/*.js     options: scenarios and thresholds, nothing else
lib/flows.js   journeys: steps, checks, think time, business metrics
lib/api.js     one function per endpoint, name tags, headers
lib/config.js  BASE_URL, PROFILE, THINK
```

A new test is a new `options` object that reuses the journeys. A changed endpoint is fixed in one function.
`byProfile({ ci, full })` keeps the CI sizes and the realistic sizes next to each other in every test, so a reader sees
at once what CI runs and what a real test would run.

## 7. Reports for people and for machines

- **The k6 web dashboard**, exported as a single HTML file (`K6_WEB_DASHBOARD_EXPORT`), is built into k6. It shows the
  charts over time where a knee or a slow creep is visible. Nothing extra needs to be installed.
- **`handleSummary()`** writes a Markdown table (endpoint percentiles and every threshold), which CI appends to the
  run summary page. This answers "what failed?" without downloading anything. It also writes the full JSON, for
  comparisons or another tool, and the normal console summary through `textSummary`.
- Not chosen: Grafana + InfluxDB/Prometheus dashboards. They are the right tool for long-running or distributed tests,
  but they would need infrastructure that a public repository cannot keep running. k6's `--out` options send the same
  metrics there when needed.

## 8. CI as a performance gate

- **Lint and app tests** come first. A typo should not cost a load-test run.
- **The smoke test is the gate.** It takes 30 s and finds broken scripts or a broken build before the 2-4 minute tests
  start.
- **load, stress and spike run in parallel** (`fail-fast: false`), each on its own runner with its own app, so they
  do not influence each other.
- **The soak test runs nightly**, because it takes too long for every push.
- **Honest limits.** A shared CI runner is noisy, so the `ci` sizes and thresholds have headroom. The pipeline catches
  regressions; capacity numbers that hold for production need dedicated load generators and a production-like
  environment (`PROFILE=full`).

## 9. What the stress test found

The first stress run showed the classic "knee". Checkout times were flat up to about 80 orders/s. At 120 orders/s,
every checkout queued for a connection without any limit: p95 passed 3 s and kept rising, until the abort threshold
stopped the run.

The fix was **load shedding**. When 40 checkouts already wait, a new one gets `503` with `Retry-After` at once. Past
the limit, some customers are told to retry, but every answer is fast and correct, and the system does not fall over
for everyone. The stress test now asserts exactly that (`order_handled` = 100%, bounded checkout p95). It also keeps
the original behaviour reproducible (`MAX_WAITING=0`).

## Not chosen

| Option | Why not |
|---|---|
| JMeter / Gatling | k6 scripts are plain JavaScript in git, with thresholds as code and a small CLI that fits CI; JMeter's XML plans are hard to review in pull requests |
| Load against a public demo site | unfair to its owner, and the results are not repeatable |
| One global p95 threshold | a slow endpoint hides behind fast ones |
| A login per iteration | unrealistic load on login, and it hides the other endpoints' behaviour |
| Fixed VUs for everything | a closed model cannot measure "orders per second", and it hides slowness as lower load |
| k6 browser module | this project is about API capacity; browser-level timings (Web Vitals) are a separate question |
