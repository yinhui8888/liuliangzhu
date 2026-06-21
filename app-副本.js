const express = require('express');
const crypto = require('crypto');
const xml2js = require('xml2js');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise'); // 引入 MySQL 模块

const app = express();
// 默认监听 3000 端口，兼容宝塔部署环境
const PORT = process.env.PORT || 3000;

// 请将这里的 'your_wechat_token' 替换为你在微信公众平台后台设置的 Token
const TOKEN = '39f86a25e5f61b72d84788a3adcd707c';

// 1. MySQL 连接池配置 (请替换为你在宝塔中创建的数据库信息)
const dbConfig = {
    host: 'localhost',
    user: 'wechat_db',       // 数据库用户名
    password: 'kenPwBaPcmn6kfy7', // 数据库密码
    database: 'wechat_db',       // 数据库名
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};
const pool = mysql.createPool(dbConfig);

// 内存缓存 (用于存放解析后的视频数据)
const dataCache = new Map();

// 支持解析 JSON 格式的 POST 请求（小程序调用 API 时使用）
app.use(express.json());
app.use(express.text({ type: ['text/xml', 'application/xml'] }));

// 定期清理解析缓存
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of dataCache.entries()) {
        if (now > value.expiry) {
            dataCache.delete(key);
        }
    }
}, 10 * 1000 * 60);

/**
 * 微信 GET 服务器验证
 */
app.get('/wechat', (req, res) => {
    const { signature, timestamp, nonce, echostr } = req.query;
    if (!signature || !timestamp || !nonce) {
        return res.status(400).send('Invalid request');
    }
    const tempArr = [TOKEN, timestamp, nonce].sort();
    const tempStr = tempArr.join('');
    const hashCode = crypto.createHash('sha1').update(tempStr).digest('hex');

    if (hashCode === signature) {
        res.send(echostr);
    } else {
        res.status(403).send('Signature verification failed');
    }
});

/**
 * 接收微信消息并校验积分 (POST)
 */
app.post('/wechat', (req, res) => {
    const xmlData = req.body;
    if (!xmlData) return res.status(400).send('No content');

    xml2js.parseString(xmlData, { explicitArray: false }, async (err, result) => {
        if (err) {
            console.error('XML 解析失败:', err);
            return res.status(500).send('Error');
        }

        const message = result ? result.xml : null;
        if (!message) return res.send('success');

        const toUser = message.FromUserName;   // 用户的 OpenID
        const fromUser = message.ToUserName;   // 公众号的微信号
        const msgType = message.MsgType;
        const content = message.Content || '';
        const createTime = Math.floor(Date.now() / 1000);

        if (msgType === 'text') {
            const douyinRegex = /(https?:\/\/v\.douyin\.com\/[A-Za-z0-9_]+)/;
            const doubaoRegex = /(https?:\/\/www\.doubao\.com\/thread\/[A-Za-z0-9_]+)/;

            let extractedUrl = '';
            let isMatched = false;

            if (content.match(douyinRegex)) {
                extractedUrl = content.match(douyinRegex)[1];
                isMatched = true;
            } else if (content.match(doubaoRegex)) {
                extractedUrl = content.match(doubaoRegex)[1];
                isMatched = true;
            }

            if (isMatched) {
                try {
                    // --- 核心：积分/免费时长校验 ---
                    const [users] = await pool.execute('SELECT expire_time FROM users WHERE openid = ?', [toUser]);
                    let isFreeUse = false;

                    if (users.length > 0) {
                        const expireTime = users[0].expire_time;
                        if (expireTime && new Date(expireTime) > new Date()) {
                            isFreeUse = true; // 仍在免费时长内
                        }
                    } else {
                        // 新用户注册
                        await pool.execute('INSERT INTO users (openid) VALUES (?) ON DUPLICATE KEY UPDATE openid=openid', [toUser]);
                    }

                    // 如果免费时长已过期或未激活
                    if (!isFreeUse) {
                        // 生成一个4位随机数字激活码
                        const activeCode = Math.floor(1000 + Math.random() * 9000).toString();
                        const expireAt = new Date(Date.now() + 15 * 60 * 1000); // 激活码15分钟有效

                        // 写入激活码表
                        await pool.execute(
                            'INSERT INTO active_codes (code, openid, expire_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE openid = VALUES(openid), expire_at = VALUES(expire_at)',
                            [activeCode, toUser, expireAt]
                        );

                        const replyContent = `⚠️ 您的免费使用时长已结束或未激活。\n\n🔑 您的专属激活码为：【${activeCode}】\n\n👉 请点击菜单栏的【小程序/获取积分】，进入小程序并输入此激活码，观看视频广告即可免费激活 8小时 无限次使用！\n*(激活码15分钟内有效)*`;
                        const replyXml = `<xml><ToUserName><![CDATA[${toUser}]]></ToUserName><FromUserName><![CDATA[${fromUser}]]></FromUserName><CreateTime>${createTime}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${replyContent}]]></Content></xml>`;
                        res.setHeader('Content-Type', 'text/xml');
                        return res.send(replyXml);
                    }

                    // --- 已拥有免费时长，继续解析逻辑 ---
                    const apiUrl = `https://api.bugpk.com/api/short_videos?url=${encodeURIComponent(extractedUrl)}`;
                    const response = await fetch(apiUrl);
                    const json = await response.json();

                    if (json && json.code === 200 && json.data) {
                        const shortId = Math.random().toString(36).substring(2, 10);
                        dataCache.set(shortId, {
                            data: json.data,
                            expiry: Date.now() + 2 * 60 * 60 * 1000
                        });

                        const host = req.get('host');
                        const protocol = req.protocol;
                        const shareUrl = `${protocol}://${host}/share?id=${shortId}`;

                        replyContent = `🎉 解析成功！\n👉 点击下方链接查看并保存资源：\n\n${shareUrl}\n\n⚠️ 提示：解析页面有效期为2小时。`;
                    } else {
                        replyContent = '解析失败，请检查链接是否正确或稍后重试。';
                    }
                } catch (apiErr) {
                    console.error('业务处理出错:', apiErr);
                    replyContent = '解析服务暂时出现故障，请稍后再试。';
                }
            } else {
                replyContent = '收到，暂未识别到有效的抖音视频或豆包图集链接。';
            }

            const replyXml = `<xml><ToUserName><![CDATA[${toUser}]]></ToUserName><FromUserName><![CDATA[${fromUser}]]></FromUserName><CreateTime>${createTime}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${replyContent}]]></Content></xml>`;
            res.setHeader('Content-Type', 'text/xml');
            res.send(replyXml);
        } else {
            res.send('success');
        }
    });
});

/**
 * 3. 供小程序调用的 API 接口：验证激活码并激活 8 小时免费时长
 * 请求方式: POST
 * 请求路径: /api/activate
 * 请求体 (JSON): { "code": "1234" }
 */
app.post('/api/activate', async (req, res) => {
    const { code } = req.body;

    if (!code) {
        return res.status(400).json({ code: 400, msg: '激活码不能为空' });
    }

    try {
        // 查找未过期的激活码
        const [rows] = await pool.execute(
            'SELECT openid FROM active_codes WHERE code = ? AND expire_at > NOW()',
            [code]
        );

        if (rows.length === 0) {
            return res.json({ code: 401, msg: '激活码无效或已过期，请重新在公众号获取' });
        }

        const openid = rows[0].openid;
        // 计算激活时长 (当前时间 + 8小时)
        const expireTime = new Date(Date.now() + 8 * 60 * 60 * 1000);

        // 更新用户的免费截止时间
        await pool.execute('UPDATE users SET expire_time = ? WHERE openid = ?', [expireTime, openid]);

        // 删除已用过的激活码
        await pool.execute('DELETE FROM active_codes WHERE code = ?', [code]);

        console.log(`[Database] 用户 ${openid} 通过激活码 ${code} 成功激活 8小时 使用权`);
        return res.json({ code: 200, msg: '激活成功！您已获得8小时免费使用权，快去公众号体验吧！' });

    } catch (err) {
        console.error('激活接口执行异常:', err);
        return res.status(500).json({ code: 500, msg: '服务器内部错误' });
    }
});

/**
 * 4. 动态渲染分享页面 (GET /share)
 */
app.get('/share', (req, res) => {
    const id = req.query.id;
    if (!id || !dataCache.has(id)) {
        return res.status(404).send('<h3>该链接已过期或不存在</h3>');
    }

    const cacheEntry = dataCache.get(id);
    const data = cacheEntry.data;

    const templatePath = path.join(__dirname, 'share.html');
    fs.readFile(templatePath, 'utf8', (err, htmlTemplate) => {
        if (err) {
            console.error('读取 share.html 失败:', err);
            return res.status(500).send('服务器配置异常');
        }

        const title = data.title || '无水印解析结果';
        const desc = data.desc || '为您提取以下无水印媒体资源。';
        let itemsHtml = '';

        if (data.type === 'image' || (data.images && Array.isArray(data.images) && data.images.length > 0)) {
            const images = data.images || [];
            images.forEach((imgUrl, index) => {
                itemsHtml += `
                <div class="item" style="text-align: center;">
                    <div class="item-header" style="justify-content: center; margin-bottom: 4px;">
                        <span class="item-name" style="color: #4b5563;">📷 图片 ${index + 1} (💡 手机端长按图片可保存到相册)</span>
                    </div>
                    <img class="img-preview" src="${imgUrl}" alt="预览图" loading="lazy" style="display: block; margin: 0 auto; max-width: 100%; border-radius: 8px;" />
                </div>`;
            });
        } else {
            let hasVideoData = false;
            if (data.url) {
                hasVideoData = true;
                itemsHtml += `
                <div class="item">
                    <div class="item-header">
                        <span class="item-name">🎬 默认高清无水印原画</span>
                        <button class="btn-copy" onclick="copyText('${data.url}', this)">复制直链</button>
                    </div>
                    <a class="url-preview" href="${data.url}" target="_blank">点击直接播放</a>
                </div>`;
            }

            const backups = Array.isArray(data.video_backup) ? data.video_backup : [];
            backups.forEach(item => {
                if (item && item.url) {
                    hasVideoData = true;
                    const quality = item.quality || '未命名分辨率';
                    const format = item.format ? item.format.toUpperCase() : 'MP4';
                    itemsHtml += `
                    <div class="item">
                        <div class="item-header">
                            <span class="item-name">🎬 备用格式: ${quality} (${format})</span>
                            <button class="btn-copy" onclick="copyText('${item.url}', this)">复制直链</button>
                        </div>
                        <a class="url-preview" href="${item.url}" target="_blank">点击直接播放</a>
                    </div>`;
                }
            });

            if (!hasVideoData) {
                itemsHtml = `<div style="text-align: center; color: #9ca3af; padding: 40px 10px;">⚠️ 未提取到有效的视频直链，请更换链接重试。</div>`;
            }
        }

        let finalHtml = htmlTemplate
            .replace('{{TITLE}}', title)
            .replace('{{DESC}}', desc)
            .replace('{{ITEMS}}', itemsHtml);

        res.send(finalHtml);
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});