// End-of-test summary. Each test exports `handleSummary = summaryFor('<test name>')`; k6 calls it once
// at the end with all metrics, and writes every returned entry to that file (or to stdout).
//
//   stdout                         the normal console summary
//   reports/<test>-summary.json    every metric, for tools or a later comparison
//   reports/<test>-summary.md      thresholds and key numbers as Markdown (CI shows it on the run page)
//
// The HTML report comes from k6's web dashboard (K6_WEB_DASHBOARD_EXPORT), see the README.

import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';

const ms = (value) => (value === undefined ? '-' : `${value.toFixed(0)} ms`);

/** One Markdown row per threshold: metric, rule, pass/fail. */
function thresholdRows(metrics) {
  const rows = [];
  for (const [name, metric] of Object.entries(metrics)) {
    for (const [rule, result] of Object.entries(metric.thresholds ?? {})) {
      rows.push(`| \`${name}\` | \`${rule}\` | ${result.ok ? '✅ pass' : '❌ fail'} |`);
    }
  }
  return rows;
}

/** Response times of every named endpoint: k6 adds a sub-metric per threshold tag. */
function endpointRows(metrics) {
  return Object.entries(metrics)
    .filter(([name]) => name.startsWith('http_req_duration{name:'))
    .map(([name, metric]) => {
      const endpoint = name.slice('http_req_duration{name:'.length, -1);
      const v = metric.values;
      return `| ${endpoint} | ${ms(v.med)} | ${ms(v['p(90)'])} | ${ms(v['p(95)'])} | ${ms(v.max)} |`;
    });
}

export function markdown(testName, data) {
  const m = data.metrics;
  const failed = Object.values(m)
    .flatMap((metric) => Object.values(metric.thresholds ?? {}))
    .filter((result) => !result.ok).length;
  const value = (name, key) => m[name]?.values[key];
  return [
    `### k6 ${testName}: ${failed === 0 ? '✅ all thresholds met' : `❌ ${failed} threshold(s) not met`}`,
    '',
    '| Requests | Failed requests | Requests/s | Iterations | Checks passed | Orders placed |',
    '|---|---|---|---|---|---|',
    `| ${value('http_reqs', 'count') ?? 0} | ${((value('http_req_failed', 'rate') ?? 0) * 100).toFixed(2)}% | ` +
      `${(value('http_reqs', 'rate') ?? 0).toFixed(1)} | ${value('iterations', 'count') ?? 0} | ` +
      `${((value('checks', 'rate') ?? 0) * 100).toFixed(2)}% | ${value('orders_placed', 'count') ?? 0} |`,
    '',
    '| Endpoint | median | p90 | p95 | max |',
    '|---|---|---|---|---|',
    ...endpointRows(m),
    '',
    '| Metric | Threshold | Result |',
    '|---|---|---|',
    ...thresholdRows(m),
    '',
  ].join('\n');
}

export function summaryFor(testName) {
  return (data) => ({
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    [`reports/${testName}-summary.json`]: JSON.stringify(data, null, 2),
    [`reports/${testName}-summary.md`]: markdown(testName, data),
  });
}
