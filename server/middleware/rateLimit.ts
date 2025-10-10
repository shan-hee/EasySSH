// Bridge stub for compiled dist to reach JS implementation (typed)
import type { Request, Response, NextFunction, RequestHandler } from 'express';

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>(); // key -> { count, resetAt }

type RateLimitOptions = {
  windowMs?: number;
  max?: number;
  keyGenerator?: (req: Request) => string;
  message?: string;
};

function rateLimit(options: RateLimitOptions = {}): RequestHandler {
  const windowMs = options.windowMs ?? 60 * 1000; // 时间窗口
  const max = options.max ?? 60; // 窗口内最大请求数
  const keyGenerator = options.keyGenerator ?? ((req: Request) => req.ip || '');
  const message = options.message ?? 'Too many requests, please try again later.';

  return function (req: Request, res: Response, next: NextFunction) {
    try {
      const key = keyGenerator(req);
      const now = Date.now();

      let bucket = buckets.get(key);
      if (!bucket || now > bucket.resetAt) {
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(key, bucket);
      }

      bucket.count += 1;

      if (bucket.count > max) {
        const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
        res.set('Retry-After', String(retryAfterSec));
        return res.status(429).json({ success: false, message });
      }

      return next();
    } catch {
      return next();
    }
  };
}

const api = { rateLimit };
module.exports = api;
export default api;
