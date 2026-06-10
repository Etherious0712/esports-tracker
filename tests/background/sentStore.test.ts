import { describe, expect, it } from 'vitest';
import type { StorageArea } from '../../src/core/storage-area';
import { getSentSet, saveSentSet } from '../../src/background/sentStore';

function makeMemoryStore(initial: Record<string, unknown> = {}): StorageArea {
  const data: Record<string, unknown> = { ...initial };
  return {
    get: async (key: string) => (key in data ? { [key]: data[key] } : {}),
    set: async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    },
  };
}

const failingStore: StorageArea = {
  get: async () => {
    throw new Error('storage unavailable');
  },
  set: async () => {
    throw new Error('storage unavailable');
  },
};

describe('sentStore', () => {
  it('SentStore_SaveThenGet_RoundTrips', async () => {
    const store = makeMemoryStore();
    await saveSentSet(new Set(['100:pre', '100:end']), store);
    const loaded = await getSentSet(store);
    expect(loaded).toStrictEqual(new Set(['100:pre', '100:end']));
  });

  it('SentStore_Empty_ReturnsEmptySet', async () => {
    expect((await getSentSet(makeMemoryStore())).size).toBe(0);
  });

  it('SentStore_ReadFailure_ReturnsEmptySet', async () => {
    // Fail safe: at worst a duplicate notification, never a crash.
    expect((await getSentSet(failingStore)).size).toBe(0);
  });

  it('SentStore_NonArrayStored_ReturnsEmptySet', async () => {
    const store = makeMemoryStore({ 'notifier:sent': 'corrupt' });
    expect((await getSentSet(store)).size).toBe(0);
  });
});
