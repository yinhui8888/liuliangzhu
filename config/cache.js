// 用于存放解析结果的共享内存缓存 (Key 为短 ID，Value 为数据)
const dataCache = new Map();

// 定期自动清理过期缓存
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of dataCache.entries()) {
        if (now > value.expiry) {
            dataCache.delete(key);
            console.log(`[Cache] 自动清理已过期解析缓存: ${key}`);
        }
    }
}, 10 * 1000 * 60);

module.exports = dataCache;