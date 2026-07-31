interface CacheEntry<T> {
  data: T;
  expiry: number;
}

class QueryCache {
  private cache = new Map<string, CacheEntry<any>>();
  private defaultTtlMs: number;

  constructor(defaultTtlMs = 60000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlMs?: number): void {
    const expiry = Date.now() + (ttlMs || this.defaultTtlMs);
    // Limit cache size to prevent memory leaks
    if (this.cache.size > 500) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, { data, expiry });
  }

  clear(): void {
    this.cache.clear();
  }
}

export const queryCache = new QueryCache(60000); // 60s TTL
