const express = require('express');
const crypto = require('crypto');
const xml2js = require('xml2js');
const pool = require('../config/db');
const dataCache = require('../config/cache');

const router = express.Router();
const TOKEN = '39f86a25e5f61b72d84788a3adcd707c'; // 替换为你的微信 Token

// 微信公众号专用的 XML 解析中间件
router.use(express.text({ type: ['text/xml', 'application/xml'] }));

/**
 * GET: 微信验证接口
 */
router.get('/', (req, res) => {
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
 * POST: 接收微信消息
 */
router.post('/', (req, res) => {
    const xmlData = req.body;
    if (!xmlData) return res.status(400).send('No content');

    xml2js.parseString(xmlData, { explicitArray: false }, async (err, result) => {
        if (err) {
            console.error('XML 解析失败:', err);
            return res.status(500).send('Error');
        }

        const message = result ? result.xml : null;
        if (!message) return res.send('success');

        const toUser = message.FromUserName;
        const fromUser = message.ToUserName;
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

            let replyContent = '收到，暂未识别到有效的抖音视频或豆包图集链接。';

            if (isMatched) {
                try {
                    // 1. 积分/免费时长校验
                    const [users] = await pool.execute('SELECT expire_time FROM users WHERE openid = ?', [toUser]);
                    let isFreeUse = false;

                    if (users.length > 0) {
                        const expireTime = users[0].expire_time;
                        if (expireTime && new Date(expireTime) > new Date()) {
                            isFreeUse = true; 
                        }
                    } else {
                        // 新用户自动插入注册
                        await pool.execute('INSERT INTO users (openid) VALUES (?) ON DUPLICATE KEY UPDATE openid=openid', [toUser]);
                    }

                    // 免费时长未激活或过期
                    if (!isFreeUse) {
                        const activeCode = Math.floor(1000 + Math.random() * 9000).toString();
                        const expireAt = new Date(Date.now() + 15 * 60 * 1000); 

                        await pool.execute(
                            'INSERT INTO active_codes (code, openid, expire_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE openid = VALUES(openid), expire_at = VALUES(expire_at)',
                            [activeCode, toUser, expireAt]
                        );

                        replyContent = `⚠️ 您的免费使用时长已结束或未激活。\n\n🔑 您的专属激活码为：【${activeCode}】\n\n👉 请点击菜单栏的【小程序/获取积分】，进入小程序输入此激活码，即可免费激活 8小时 无限次使用！\n*(激活码15分钟内有效)*`;
                    } else {
                        // 2. 时长有效，调用接口解析
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
                    }
                } catch (apiErr) {
                    console.error('公众号业务处理出错:', apiErr);
                    replyContent = '解析服务暂时出现故障，请稍后再试。';
                }
            }

            const replyXml = `<xml><ToUserName><![CDATA[${toUser}]]></ToUserName><FromUserName><![CDATA[${fromUser}]]></FromUserName><CreateTime>${createTime}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${replyContent}]]></Content></xml>`;
            res.setHeader('Content-Type', 'text/xml');
            res.send(replyXml);
        } else {
            res.send('success');
        }
    });
});

module.exports = router;