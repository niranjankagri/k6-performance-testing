// End-of-test summary. Each test exports `handleSummary = summaryFor('<test name>', '<case id>')`; k6 calls it once
// at the end with all metrics, and writes every returned entry to that file (or to stdout).
//
//   stdout                         the normal console summary
//   reports/<test>-summary.json    every metric, for tools or a later comparison
//   reports/<test>-summary.md      thresholds and key numbers as Markdown (CI shows it on the run page)
//   reports/<test>-junit.xml       one JUnit test case per threshold (for CI result collections)
//
// The HTML report comes from k6's web dashboard (K6_WEB_DASHBOARD_EXPORT), see the README.

import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';

/** A time in whole milliseconds, or '-' when k6 has no value for it. */
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

/** The checkout's own Trend (the order endpoint has no name-tag threshold of its own). */
function checkoutRow(metrics) {
  const v = metrics.checkout_duration?.values;
  return v
    ? [
        `| POST /api/orders (checkout_duration) | ${ms(v.med)} | ${ms(v['p(90)'])} | ${ms(v['p(95)'])} | ${ms(v.max)} |`,
      ]
    : [];
}

/** "[TC-302] load": the test name with its test case ID (docs/manual-test-cases.md) in front, when there is one. */
const title = (testName, caseId) => (caseId ? `[${caseId}] ${testName}` : testName);

/** The Markdown report: a verdict line, totals, response times per endpoint and every threshold. */
export function markdown(testName, data, caseId) {
  const m = data.metrics;
  const failed = Object.values(m)
    .flatMap((metric) => Object.values(metric.thresholds ?? {}))
    .filter((result) => !result.ok).length;
  /**
   * One value of a metric (for example http_reqs / count), or undefined when the test did not record that metric.
   */
  const value = (name, key) => m[name]?.values[key];
  return [
    `### k6 ${title(testName, caseId)}: ${failed === 0 ? '✅ all thresholds met' : `❌ ${failed} threshold(s) not met`}`,
    '',
    '| Requests | Failed requests | Requests/s | Iterations | Checks passed | Orders placed | Orders refused (503) |',
    '|---|---|---|---|---|---|---|',
    `| ${value('http_reqs', 'count') ?? 0} | ${((value('http_req_failed', 'rate') ?? 0) * 100).toFixed(2)}% | ` +
      `${(value('http_reqs', 'rate') ?? 0).toFixed(1)} | ${value('iterations', 'count') ?? 0} | ` +
      `${((value('checks', 'rate') ?? 0) * 100).toFixed(2)}% | ${value('orders_placed', 'count') ?? 0} | ${value('orders_refused', 'count') ?? 0} |`,
    '',
    '| Endpoint | median | p90 | p95 | max |',
    '|---|---|---|---|---|',
    ...endpointRows(m),
    ...checkoutRow(m),
    '',
    '| Metric | Threshold | Result |',
    '|---|---|---|',
    ...thresholdRows(m),
    '',
  ].join('\n');
}

/** Text with the five XML special characters escaped, for attribute values. */
const xml = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * JUnit XML of a test: one test case per threshold, failed when k6 reports it as not met. Thresholds are the
 * test's pass/fail criteria, so this is what a CI result collection (automation-coverage-quality-intelligence)
 * should count; the numbers themselves stay in the JSON and Markdown summaries. The case ID goes into the suite
 * name only: classname and test case names stay as they were, so collected results keep their history.
 */
export function junit(testName, data, caseId) {
  const cases = [];
  let failures = 0;
  for (const [name, metric] of Object.entries(data.metrics)) {
    for (const [rule, result] of Object.entries(metric.thresholds ?? {})) {
      const id = `${name} ${rule}`;
      const failure = result.ok ? '' : `<failure message="${xml(`threshold not met: ${id}`)}"/>`;
      failures += result.ok ? 0 : 1;
      cases.push(
        `    <testcase classname="k6.${xml(testName)}" name="${xml(id)}" time="0">${failure}</testcase>`,
      );
    }
  }
  const seconds = ((data.state?.testRunDurationMs ?? 0) / 1000).toFixed(3);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<testsuites>',
    `  <testsuite name="k6 ${xml(title(testName, caseId))}" tests="${cases.length}" failures="${failures}" errors="0" skipped="0" time="${seconds}">`,
    ...cases,
    '  </testsuite>',
    '</testsuites>',
    '',
  ].join('\n');
}

/**
 * Builds the handleSummary function of one test; the name is used in the file names under reports/, the case ID
 * (e.g. 'TC-302') in the report titles.
 */
export function summaryFor(testName, caseId) {
  return (data) => ({
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    [`reports/${testName}-summary.json`]: JSON.stringify(data, null, 2),
    [`reports/${testName}-summary.md`]: markdown(testName, data, caseId),
    [`reports/${testName}-junit.xml`]: junit(testName, data, caseId),
  });
}
