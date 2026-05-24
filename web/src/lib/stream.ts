// web/src/lib/stream.ts
// Consumes a text/event-stream response from a fetch() call.
// (NOT EventSource — that doesn't support custom headers like X-Scry-Csrf.)
// Used by Plan C's search route.
//
// Cancellation: this consumer checks `signal?.aborted` between read() calls,
// which means a stalled stream (long pause between bytes) won't observe an
// abort until the next chunk arrives. The proper fix lives at the call site:
// pass `signal` to the upstream `fetch()` so an abort terminates the underlying
// HTTP socket, which in turn unblocks `reader.read()`. Plan C wiring should do
// `apiFetch(path, { method: 'POST', body, signal })` and pass the same `signal`
// here.

export interface StreamHandler<T> {
  onEvent: (event: T) => void;
  onError?: (err: Error) => void;
  onDone?: () => void;
}

export async function consumeStream<T>(
  res: Response,
  handler: StreamHandler<T>,
  signal?: AbortSignal,
): Promise<void> {
  if (!res.body) throw new Error('No response body for stream');
  if (!res.headers.get('Content-Type')?.startsWith('text/event-stream')) {
    throw new Error('Response is not text/event-stream');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const data = block
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('\n');
        if (!data) continue;
        try {
          const parsed = JSON.parse(data) as T;
          handler.onEvent(parsed);
        } catch (err) {
          handler.onError?.(err as Error);
        }
      }
    }
    handler.onDone?.();
  } catch (err) {
    handler.onError?.(err as Error);
  }
}
