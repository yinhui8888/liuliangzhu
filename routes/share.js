const express = require('express');
const fs = require('fs');
const path = require('path');
const dataCache = require('../config/cache');

const router = express.Router();

/**
 * GET: 动态渲染网页
 */
router.get('/', (req, res) => {
    const id = req.query.id;
    if (!id || !dataCache.has(id)) {
        return res.status(404).send('<h3>该链接已过期或不存在</h3>');
    }

    const cacheEntry = dataCache.get(id);
    const data = cacheEntry.data;

    // 定位到同级或上级目录的 share.html
    const templatePath = path.join(__dirname, '../share.html');
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

module.exports = router;