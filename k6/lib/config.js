// Run settings shared by every test, read from environment variables (k6 run -e NAME=value, or the shell).
//
//   BASE_URL  where QuickShop runs                       default http://localhost:3000
//   PROFILE   how big and how long the load is:
//               ci   - minutes, small load: fits a CI job and a laptop (default)
//               full - the realistic sizes and durations, for a dedicated test environment
//   THINK     multiplier for the pauses between user actions (0 = no pauses)   default 1

// Without a trailing slash, so paths can be appended as `${BASE_URL}/api/...`
export const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
export const PROFILE = __ENV.PROFILE || 'ci';
export const THINK = Number(__ENV.THINK ?? 1);

/**
 * Picks this run's values from a { ci: ..., full: ... } object, so every test declares
 * both sizes side by side and the reader sees at once what CI runs and what a real test runs.
 */
export function byProfile(values) {
  const chosen = values[PROFILE];
  if (chosen === undefined) {
    throw new Error(`Unknown PROFILE "${PROFILE}": use one of ${Object.keys(values).join(', ')}`);
  }
  return chosen;
}
