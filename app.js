const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// 1. 引入拆分后的各大功能路由模块
const wechatRouter = require('./routes/wechat');
const shareRouter = require('./routes/share');
const apiRouter = require('./routes/api');

// 2. 挂载路由（解耦设计，方便后续极简扩容）
app.use('/wechat', wechatRouter); // 公众号相关路由
app.use('/share', shareRouter);   // 分享H5页面路由
app.use('/api', apiRouter);       // 小程序或其他第三方API路由

app.listen(PORT, () => {
    console.log(`[Server] Node 业务服务成功启动，正在监听端口: ${PORT}`);
});