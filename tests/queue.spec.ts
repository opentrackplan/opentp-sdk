import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EventQueue } from '../src/queue';
import type { DispatchedEvent } from '../src/types';

function mockEvent(name = 'event'): DispatchedEvent {
  return {
    area: 'test',
    eventName: name,
    key: `test::${name}`,
    payload: {},
    timestamp: Date.now(),
    metadata: {},
  };
}

describe('EventQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('flushes when maxSize is reached', async () => {
    const onFlush = vi.fn();
    const queue = new EventQueue({ maxSize: 2, flushInterval: 10000 }, onFlush);

    queue.push(mockEvent('1'));
    expect(onFlush).not.toHaveBeenCalled();

    queue.push(mockEvent('2'));
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith([mockEvent('1'), mockEvent('2')]);

    await queue.destroy();
  });

  it('flushes on interval', async () => {
    const onFlush = vi.fn();
    const queue = new EventQueue({ maxSize: 10, flushInterval: 5000 }, onFlush);

    queue.push(mockEvent('1'));
    expect(onFlush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    expect(onFlush).toHaveBeenCalledTimes(1);

    await queue.destroy();
  });

  it('flushes on destroy', async () => {
    const onFlush = vi.fn();
    const queue = new EventQueue({ maxSize: 10, flushInterval: 10000 }, onFlush);

    queue.push(mockEvent('1'));
    queue.push(mockEvent('2'));
    expect(onFlush).not.toHaveBeenCalled();

    await queue.destroy();
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith([mockEvent('1'), mockEvent('2')]);
  });

  it('clears interval timer on destroy', async () => {
    const onFlush = vi.fn();
    const queue = new EventQueue({ maxSize: 10, flushInterval: 5000 }, onFlush);

    // Add an event so flush actually does something
    queue.push(mockEvent('1'));

    await queue.destroy();

    // Advance time and verify no more flushes happen
    vi.advanceTimersByTime(10000);
    expect(onFlush).toHaveBeenCalledTimes(1); // only the destroy flush
  });

  it('handles empty flush gracefully', async () => {
    const onFlush = vi.fn();
    const queue = new EventQueue({ maxSize: 10, flushInterval: 10000 }, onFlush);

    await queue.flush();
    expect(onFlush).not.toHaveBeenCalled();

    await queue.destroy();
  });

  it('does not create timer if flushInterval is 0', async () => {
    const onFlush = vi.fn();
    const queue = new EventQueue({ maxSize: 10, flushInterval: 0 }, onFlush);

    queue.push(mockEvent('1'));

    vi.advanceTimersByTime(10000);
    expect(onFlush).not.toHaveBeenCalled(); // no timer, only maxSize triggers flush

    await queue.destroy();
    expect(onFlush).toHaveBeenCalledTimes(1);
  });
});
