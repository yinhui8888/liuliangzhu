const express = require('express');
const pool = require('../config/db');

const router = express.Router();

// 支持 JSON 格式的数据解析
router.use(express.json());

/**
 * POST: 激活码验证激活接口
 */
router.post('/activate', async (req, res) => {
    const { code } = req.body;

    if (!code) {
        return res.status(400).json({ code: 400, msg: '激活码不能为空' });
    }

    try {
        const [rows] = await pool.execute(
            'SELECT openid FROM active_codes WHERE code = ? AND expire_at > NOW()',
            [code]
        );

        if (rows.length === 0) {
            return res.json({ code: 401, msg: '激活码无效或已过期，请重新在公众号获取' });
        }

        const openid = rows[0].openid;
        const expireTime = new Date(Date.now() + 8 * 60 * 60 * 1000); // 延时 8 小时

        await pool.execute('UPDATE users SET expire_time = ? WHERE openid = ?', [expireTime, openid]);
        await pool.execute('DELETE FROM active_codes WHERE code = ?', [code]);

        console.log(`[API] 验证成功，用户 ${openid} 免费时长已增加。`);
        return res.json({ code: 200, msg: '激活成功！已获得 8 小时免费体验时间！' });

    } catch (err) {
        console.error('API 激活接口异常:', err);
        return res.status(500).json({ code: 500, msg: '服务器内部错误' });
    }
});

module.exports = router;