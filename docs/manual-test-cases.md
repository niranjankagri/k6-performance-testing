# Manual test cases

The performance test cases this project automates with k6, written the way a performance tester
plans and runs them: goal, workload, pass criteria and what to look at. Every case has an ID; the k6
script that covers it carries the same ID as the `testid` tag on all its metrics and in its report
titles (`### k6 [TC-302] load: ...`, JUnit suite `k6 [TC-302] load`), so a result leads straight to
the case below.

Running a performance test "by hand" still needs a load tool; the manual part is preparing the
system, starting the run, watching it (k6 web dashboard) and judging the result against the
criteria. Not listed: the app's own tests (`app/server.test.js`) and the `regression-demo` CI job,
which fails a threshold on purpose.

## Setup

- System under test: QuickShop, `npm start` (port 3000), on a machine that is otherwise idle. Restart
  it before each case (orders are kept in memory).
- Test users: `data/users.csv`.
- Two profiles: `ci` (default, minutes) and `full` (`-e PROFILE=full`, realistic duration and users).
- Watch live: `K6_WEB_DASHBOARD=true k6 run ...`, then open <http://localhost:5665>.
- Journeys: **browsing** (products, product page, search) and **buying** (login, add to cart, checkout).

## Service level objectives (SLOs) used by the cases

| Metric | Target |
|---|---|
| Failed requests | < 1 % |
| Functional checks passed | > 99 % |
| p95 `GET /api/products` / `GET /api/products/:id` / `GET /api/search` | < 200 / 150 / 300 ms |
| p95 `POST /api/auth/login` / `POST /api/cart/items` | < 250 / 200 ms |
| Checkout duration | p95 < 400 ms, p99 < 600 ms |
| Orders placed successfully | > 99 % |

## Summary

| ID | Title | Type | Priority | Script |
|---|---|---|---|---|
| TC-301 | One user, every journey, nothing fails | Smoke | High | `k6/tests/smoke.js` |
| TC-302 | Expected busy-day traffic meets the SLOs | Load | High | `k6/tests/load.js` |
| TC-303 | Capacity limit and graceful degradation | Stress | High | `k6/tests/stress.js` |
| TC-304 | Sudden spike survived, and recovery afterwards | Spike | Medium | `k6/tests/spike.js` |
| TC-305 | Normal load over time: no slow-down, memory within budget | Soak | Medium | `k6/tests/soak.js` |

---

### TC-301 One user, every journey, nothing fails

Goal: the system works under minimal load and the scripts still match the API, before any bigger test.

| Field | Value |
|---|---|
| Run | `k6 run k6/tests/smoke.js` |
| Workload | 1 virtual user for 30 s (`full`: 1 min), every journey |
| Pass criteria | No failed request (0 %); every check passes (100 %); the endpoint response-time SLOs above |
| Look at | Any failed check names the step that broke |

### TC-302 Expected busy-day traffic meets the SLOs

Goal: the system meets its response-time and error targets under normal peak load.

| Field | Value |
|---|---|
| Run | `k6 run k6/tests/load.js` (`-e PROFILE=full` for 20 min) |
| Workload | Two scenarios at once. Browsers (closed model): ramp to 20 users in 20 s, hold 1 min 20 s, ramp down (`full`: 200 users, 15 min). Buyers (open model): 2 new orders per second (`full`: 20/s) whatever the response time |
| Pass criteria | All SLOs above; no dropped iterations (k6 had enough users to keep the arrival rate) |
| Look at | p95 per endpoint over time: flat, not creeping up |

### TC-303 Capacity limit and graceful degradation

Goal: find the throughput limit and check that past it the system degrades gracefully (slower or
refused, but correct), not badly (errors, wrong data). Expected limit: 8 database connections × ~90 ms
per checkout ≈ 90 orders/s.

| Field | Value |
|---|---|
| Run | `k6 run k6/tests/stress.js` |
| Workload | Orders per second in held steps: 40, 80, 120, then 0 (recovery); no think time |
| Pass criteria | Every order is placed with the right total **or** refused with `503`: never a `500`, a timeout or a wrong total; checkout p95 < 1.5 s; `POST /api/cart/items` p95 < 300 ms while checkout is saturated; failed requests < 10 % (only refused orders) |
| Look at | The "knee" in checkout time around 90 orders/s; the count of refused orders (503) above it; recovery to normal times in the last step |

### TC-304 Sudden spike survived, and recovery afterwards

Goal: survive a sudden burst (newsletter, sale at 09:00) and come back to normal afterwards.

| Field | Value |
|---|---|
| Run | `k6 run k6/tests/spike.js` |
| Workload | Browsers: 5 users for 20 s, jump to 150 within 10 s, hold 40 s, back to 5 and watch 30 s (`full`: 20 → 600). Orders keep arriving at the normal rate throughout |
| Pass criteria | Failed requests < 2 %; checks > 98 %; every order handled correctly; p95 products < 500 ms, search < 800 ms, checkout < 600 ms (looser than the SLOs during the spike) |
| Look at | Response times in the recovery phase: back to the baseline, not stuck high |

### TC-305 Normal load over time: no slow-down, memory within budget

Goal: problems that need time: memory leaks, growing queues, connections never closed, response times
that creep up.

| Field | Value |
|---|---|
| Run | `k6 run k6/tests/soak.js` (`-e PROFILE=full` for 4 hours) |
| Workload | 10 browsing users (`full`: 100) and a constant order rate for the whole run; a third scenario reads `/health` every 10 s and records the server's memory (`server_rss_mb`) |
| Pass criteria | All SLOs; no dropped iterations; server memory max < 200 MB (`full`: < 1 GB) |
| Look at | `server_rss_mb` over time (QuickShop keeps orders in memory, so some growth is expected; it must stay within the budget) and p95 at the end vs. the start |
