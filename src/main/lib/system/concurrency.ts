/** Run tasks with a bounded number in flight, preserving result order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  async function runNext(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index]!, index)
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, runNext)
  await Promise.all(runners)
  return results
}
