import 'fake-indexeddb/auto';
import '@testing-library/jest-dom';
import { afterAll, beforeEach } from 'vitest';
import { db } from '@/db/appDb';

beforeEach(async () => {
  db.close();
  await db.delete();
  await db.open();
});

afterAll(async () => {
  db.close();
  await db.delete();
});
