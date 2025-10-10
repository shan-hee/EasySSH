"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const buckets = new Map(); // key -> { count, resetAt }
function rateLimit(options = {}) {
    const windowMs = options.windowMs ?? 60 * 1000; // 时间窗口
    const max = options.max ?? 60; // 窗口内最大请求数
    const keyGenerator = options.keyGenerator ?? ((req) => req.ip || '');
    const message = options.message ?? 'Too many requests, please try again later.';
    return function (req, res, next) {
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
        }
        catch {
            return next();
        }
    };
}
const api = { rateLimit };
module.exports = api;
exports.default = api;
