# k6 for beginners: run the tests and read the results

No k6 knowledge needed. This page explains what this project does, how to run it with one command, and how to
read what you see.

## What is this about?

A website can work perfectly for one person and still fail when 1,000 people use it at once: pages get slow,
orders time out, the server falls over. **Performance tests** check that before real customers find out.

**k6** is the tool that plays those many users. You write down what one user does (open the shop, look at a
product, buy something). k6 then runs that script for many simulated users at the same time and measures how fast
every answer comes back.

Here, the "website" is **QuickShop**, a small demo shop that lives in this project. You test your own copy on your
own computer, so you never put load on anybody else's server.

## Run a test: one command

You need [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) and Node.js installed. Then, in a terminal:

```
cd D:\Data\Work\k6-performance-testing      (in cmd.exe: cd /d D:\Data\Work\k6-performance-testing)
npm install                                 (only the very first time)
npm run load
```

That one command does everything:

1. it starts the demo shop;
2. it runs the test, and your browser opens a page with **live charts**;
3. when the test ends, it saves the report and opens it;
4. it stops the shop;
5. it prints **PASSED** or **FAILED** in the terminal.

### The tests

| Command | What it simulates | Takes | The question |
|---|---|---|---|
| `npm run smoke` | 1 user | 30 s | Does everything work at all? (always run this first) |
| `npm run load` | 20 visitors + 2 orders per second | 2 min | Are we fast enough on a normal busy day? |
| `npm run stress` | more and more orders per second | 3 min | Where is the limit, and what happens past it? |
| `npm run spike` | visitors jump from 5 to 150 in 10 s | 2 min | Do we survive a sudden rush, and calm down afterwards? |
| `npm run soak` | steady traffic | 4 min | Does anything slowly get worse over time? (in real life: hours) |
| `npm run regression` | the load test against a deliberately slowed shop | 2 min | Does the test catch a slow release? (it **should** fail) |

## What you see

**In the terminal**, a progress bar while the test runs:

```
running (0m45.0s), 20/20 VUs, 120 complete and 0 interrupted iterations
```

"20 VUs" means 20 simulated users are active right now. "120 complete iterations" means they have finished 120
visits or orders so far.

At the end you get a long list of numbers, and then the verdict:

```
▶ PASSED. k6 load: ✅ all thresholds met
```

**In the browser**, the live charts update every few seconds:
- requests per second;
- response times;
- the number of users;
- failed requests.

When the test ends, the same page is saved as `reports\load-report.html` and opened.

## How to read the result: three things are enough

1. **Did it pass?** The last lines say PASSED or FAILED. FAILED means at least one *limit* (k6 calls it a
   *threshold*) was not met. The result table `reports\load-summary.md` marks it with ❌.
2. **How fast was it?** Look at **p95** per page: "95% of the requests were at least this fast". For example,
   `GET /api/products p95 = 39 ms` means 95 out of 100 product lists came back within 39 milliseconds. p95 is used
   instead of the average because the average hides the slow requests that annoy people.
3. **Did anything break?** Look at **failed requests**, which should be about 0%, and **checks passed**, which
   should be about 100%. Checks are little yes/no questions about every answer, such as "status 200?" or "does the
   order total match the cart?". A fast wrong answer is still wrong.

The limits this project uses: product pages under 150-200 ms, search under 300 ms, checkout under 400 ms (all at
p95); fewer than 1% failed requests; more than 99% passed checks.

## Try this: watch a test catch a problem

```
npm run regression
```

This starts the shop with a fake "slow release": every checkout takes 300 ms longer. Everything still *works*
(100% of checks pass), but checkout now takes about 425 ms where 400 ms is the limit. The test fails, and the
terminal explains that this failure is expected. This is exactly what the tests are for: catching a slowdown before
customers notice it.

Then run `npm run stress` and watch the **response time** chart. At first the line is flat. When the orders per
second pass what the shop can handle, it climbs and then levels off. The levelling off is the protection
added after this test found the problem: when too many orders wait, the shop politely says "try again in a second"
(503) instead of making everyone wait longer and longer. The README's "Finding" section has the before and after
pictures.

## Words you will see

| Word | Meaning |
|---|---|
| **VU** (virtual user) | one simulated user; k6 runs many at once |
| **iteration** | one run of a user's script: one visit, or one order |
| **think time** | the pause a real person makes between clicks (1-3 s here) |
| **check** | a yes/no question about one answer (status 200? right total?) |
| **threshold** | a pass/fail limit for the whole test (p95 under 400 ms); one missed threshold = FAILED |
| **p95 / p90 / p99** | 95% / 90% / 99% of the requests were at least this fast |
| **median** | half the requests were faster, half slower |
| **http_req_duration** | how long one request took, from sending to the last byte of the answer |
| **http_req_failed** | the share of requests that failed (errors, or no answer) |
| **requests per second** | how much traffic the test created |
| **scenario** | one group of users with their own behaviour, such as "visitors" or "buyers"; several run at once |
| **SLO** | the agreed speed and error targets; here they are the thresholds |

## Common questions

**Can I run a test while `npm start` is running?** Yes. The `npm run ...` commands start their own copy of the
shop on another port (3100).

**"k6 is not recognized" or the wrong k6 version?** Check with `k6 version`; it should say v2.x. If Windows does
not find it, the k6 folder is missing from your PATH. Open a new terminal after installing.

**The browser did not open?** Just open `reports\<test>-report.html` yourself after the test. While a
test runs, the live page is at http://localhost:5665.

**Where are the results kept?** In the `reports` folder:
- `<test>-report.html`: the charts;
- `<test>-summary.md`: the result table;
- `<test>-summary.json`: every number.

The folder is not saved to git.

**Can I run the tests the "real" k6 way?** Yes: start the shop with `npm start`, then `k6 run k6/tests/load.js` in a
second terminal. The README explains that, and all the options.
