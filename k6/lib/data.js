// Test data: the users from data/users.csv and the shop's search terms and categories.

import { SharedArray } from 'k6/data';

// SharedArray: the file is read and parsed once, and every VU shares the same read-only copy
// (a plain array would be copied into each VU's memory: 1,000 VUs = 1,000 copies).
export const users = new SharedArray('users', () =>
  open('../../data/users.csv')
    .trim()
    .split('\n')
    .slice(1) // header
    .map((line) => {
      const [username, password] = line.split(',');
      return { username, password };
    }),
);

export const CATEGORIES = ['books', 'games', 'garden', 'kitchen', 'music'];
export const SEARCH_TERMS = ['books', 'item 1', 'garden item', 'music', 'kitchen item 2', 'games'];
export const PRODUCT_COUNT = 50;

/** A different user for every VU, so carts and orders of parallel VUs never mix. */
export const userForVu = (vu) => users[(vu - 1) % users.length];

/** A random element of a list. */
export const randomItem = (list) => list[Math.floor(Math.random() * list.length)];
/** A random whole number from min to max, both included. */
export const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
