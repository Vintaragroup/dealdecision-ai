import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useToastQueue } from '../components/ui/Toast';

// Prevent document.head.appendChild from running during tests
vi.mock('../components/ui/Toast', async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return mod;
});

describe('useToastQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('appends toasts and respects MAX_VISIBLE_TOASTS cap', () => {
    const { result } = renderHook(() => useToastQueue(4));

    act(() => {
      for (let i = 1; i <= 5; i++) {
        result.current.push({ type: 'info', title: `Toast ${i}` });
      }
    });

    // Only the 4 most-recent toasts should be visible; oldest evicted.
    expect(result.current.toasts).toHaveLength(4);
    expect(result.current.toasts.map((t) => t.title)).toEqual([
      'Toast 2',
      'Toast 3',
      'Toast 4',
      'Toast 5',
    ]);
  });

  it('replaces existing toast in-place when same key is pushed again', () => {
    const { result } = renderHook(() => useToastQueue(4));

    act(() => {
      result.current.push({ type: 'info', title: 'Original', key: 'my-key' });
      result.current.push({ type: 'info', title: 'Other', key: 'other-key' });
    });

    // Update the first toast by pushing the same key
    act(() => {
      result.current.push({ type: 'warning', title: 'Updated', key: 'my-key' });
    });

    expect(result.current.toasts).toHaveLength(2);
    const myToast = result.current.toasts.find((t) => t.key === 'my-key');
    expect(myToast?.title).toBe('Updated');
    expect(myToast?.type).toBe('warning');
    // Position 0 (my-key was added first) should still be first
    expect(result.current.toasts[0].key).toBe('my-key');
  });

  it('auto-dismisses success toasts after 5 s', () => {
    const { result } = renderHook(() => useToastQueue(4));

    act(() => {
      result.current.push({ type: 'success', title: 'Saved!' });
    });

    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(result.current.toasts).toHaveLength(0);
  });

  it('does NOT auto-dismiss sticky error toasts', () => {
    const { result } = renderHook(() => useToastQueue(4));

    act(() => {
      result.current.push({ type: 'error', title: 'Something broke' });
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].sticky).toBe(true);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    // Still present — sticky error should not auto-dismiss
    expect(result.current.toasts).toHaveLength(1);
  });

  it('evicts oldest non-sticky entry first when queue is full', () => {
    const { result } = renderHook(() => useToastQueue(2));

    act(() => {
      result.current.push({ type: 'info', title: 'Old info', key: 'a' });
      result.current.push({ type: 'error', title: 'Sticky error', key: 'b', sticky: true });
    });

    expect(result.current.toasts).toHaveLength(2);

    // Adding a third should evict the non-sticky 'Old info'
    act(() => {
      result.current.push({ type: 'success', title: 'New success', key: 'c' });
    });

    expect(result.current.toasts).toHaveLength(2);
    const keys = result.current.toasts.map((t) => t.key);
    expect(keys).not.toContain('a'); // 'Old info' evicted
    expect(keys).toContain('b'); // sticky error preserved
    expect(keys).toContain('c');
  });

  it('dismiss removes a specific toast by id', () => {
    const { result } = renderHook(() => useToastQueue(4));

    act(() => {
      result.current.push({ type: 'info', title: 'A' });
      result.current.push({ type: 'info', title: 'B' });
    });

    const idToRemove = result.current.toasts[0].id;

    act(() => {
      result.current.dismiss(idToRemove);
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].title).toBe('B');
  });
});
