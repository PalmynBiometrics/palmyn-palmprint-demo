// Rate limit en memoria con ventana deslizante. Alcanza para un solo proceso Node
// (como corre en Hostinger); con varias instancias habria que moverlo a Redis.
class RateLimiter {
  constructor() {
    this.hits = new Map();
    this.timer = setInterval(() => this.sweep(), 10 * 60 * 1000);
    this.timer.unref();
  }

  // true si se permite; registra el intento.
  take(key, limit, windowMs = 3600_000, now = Date.now()) {
    if (limit <= 0) return true;
    const arr = (this.hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= limit) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }

  sweep(now = Date.now(), windowMs = 3600_000) {
    for (const [k, arr] of this.hits) {
      const keep = arr.filter((t) => now - t < windowMs);
      if (keep.length) this.hits.set(k, keep); else this.hits.delete(k);
    }
  }
}

module.exports = { RateLimiter };
