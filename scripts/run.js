// One command per test, for people who just want to run it and look at the result:
//
//   npm run smoke | load | stress | spike | soak | regression
//
// It starts its own QuickShop, runs the k6 test with the live dashboard in the browser, saves the HTML
// report and opens it, stops QuickShop again, and says in plain words whether the test passed.
// Nothing else needs to run first, and no environment variables need to be set.
//
// Options: --no-open  do not open the browser (CI, or when you only want the files)
//          K6_BIN=... the k6 program to use (default: k6 from PATH)

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// The shop for this run gets its own port, so it never clashes with an `npm start` that is already running
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

// What each test is, in one sentence, and how to run it
const TESTS = {
  smoke: { script: 'smoke.js', about: '1 user for 30 s: does everything work at all?' },
  load: {
    script: 'load.js',
    about: '20 visitors + 2 orders per second for 2 min: are we fast enough on a busy day?',
  },
  stress: {
    script: 'stress.js',
    about: 'more and more orders per second, past the limit: where does it break, and how?',
    k6Env: { THINK: '0' },
  },
  spike: { script: 'spike.js', about: 'visitors jump 30x within 10 s: do we survive and recover?' },
  soak: {
    script: 'soak.js',
    about: 'steady traffic for 4 min (hours in real life): does anything slowly get worse?',
  },
  regression: {
    script: 'load.js',
    about: 'the load test against a "slow release" (checkout 300 ms slower): it SHOULD fail',
    appEnv: { CHECKOUT_DELAY_MS: '300' },
    expectFailure: true,
  },
};

const name = process.argv[2];
const openBrowser = !process.argv.includes('--no-open');
const test = TESTS[name];
if (!test) {
  console.log(`Which test? One of: ${Object.keys(TESTS).join(', ')}   (for example: npm run load)`);
  process.exit(2);
}

const say = (text) => console.log(`\n▶ ${text}`);

/** Opens a file or URL with the system's default program (browser for .html). */
function openFile(target) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', target]]
      : [process.platform === 'darwin' ? 'open' : 'xdg-open', [target]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
}

/** Starts QuickShop on PORT and waits (up to 10 s) until it answers. */
async function startShop() {
  const shop = spawn(process.execPath, ['app/server.js'], {
    env: { ...process.env, PORT: String(PORT), ...test.appEnv },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE_URL}/health`)).ok) return shop;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  shop.kill();
  throw new Error(`QuickShop did not start on port ${PORT} (is another program using it?)`);
}

/** Runs k6 and resolves with its exit code (0 = all thresholds met, 99 = a threshold failed). */
function runK6(reportFile) {
  const k6 = process.env.K6_BIN || 'k6';
  const child = spawn(k6, ['run', `k6/tests/${test.script}`], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...test.k6Env,
      BASE_URL,
      // The live dashboard (http://localhost:5665) while the test runs, and the same page saved as a file
      K6_WEB_DASHBOARD: 'true',
      K6_WEB_DASHBOARD_OPEN: openBrowser ? 'true' : 'false',
      K6_WEB_DASHBOARD_PERIOD: '3s',
      K6_WEB_DASHBOARD_EXPORT: reportFile,
    },
  });
  return new Promise((resolve, reject) => {
    child.on('error', (error) =>
      reject(
        error.code === 'ENOENT'
          ? new Error(
              'k6 was not found. Install it (https://grafana.com/docs/k6/latest/set-up/install-k6/) or set K6_BIN.',
            )
          : error,
      ),
    );
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

const reportFile = `reports/${name}-report.html`;
const summaryFile = `reports/${test.script.replace('.js', '')}-summary.md`;

say(`${name} test: ${test.about}`);
say(`Starting the demo shop on ${BASE_URL} ...`);
const shop = await startShop();
let code;
try {
  say(
    openBrowser
      ? 'Running k6. The live charts open in your browser (http://localhost:5665); the terminal shows progress.'
      : 'Running k6.',
  );
  code = await runK6(reportFile);
} finally {
  shop.kill();
}

// The verdict, in plain words, from the first line of the Markdown summary k6 just wrote
const verdict = existsSync(summaryFile)
  ? readFileSync(summaryFile, 'utf8')
      .split('\n')[0]
      .replace(/^#+\s*/, '')
  : '';
console.log('\n────────────────────────────────────────────────────────────');
if (code === 0) say(`PASSED. ${verdict}`);
else if (code === 99) say(`FAILED: at least one limit (threshold) was not met. ${verdict}`);
else say(`k6 stopped with exit code ${code} (an error, not a result: see the messages above).`);
if (test.expectFailure) {
  say(
    code === 99
      ? 'This failure is the point of the demo: everything still works, but checkout is too slow, and the test caught it.'
      : 'Unexpected: the demo should have failed on the checkout time.',
  );
}
say(`Result table: ${summaryFile}`);
say(`Full report:  ${reportFile}${openBrowser && existsSync(reportFile) ? ' (opening it now)' : ''}`);
if (openBrowser && existsSync(reportFile)) openFile(reportFile);

// The regression demo counts as "OK" when it failed as expected
process.exit(test.expectFailure ? (code === 99 ? 0 : 1) : code);
