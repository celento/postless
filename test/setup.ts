import {afterEach, beforeEach} from 'vitest';

beforeEach(() => {
  process.env.TEST_SECRET = 'secret';
});

afterEach(() => {
  delete process.env.TEST_SECRET;
});
