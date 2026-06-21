const mysql = require('mysql2/promise');

// 1. 数据库基础配置（请在此修改为你的真实宝塔 MySQL 账号密码）
const dbConfig = {
    host: 'localhost',
    user: 'wechat_db',       // 数据库用户名
    password: 'kenPwBaPcmn6kfy7', // 数据库密码
    database: 'wechat_db',       // 数据库名
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 5000         // 5秒连接超时，防止数据库连不上时程序无限挂起
};

const pool = mysql.createPool(dbConfig);

// 2. [核心改进] 启动时自动测试连接，确保数据库配置无误
pool.getConnection()
    .then(conn => {
        console.log('[Database] MySQL 数据库连接成功！模块运行正常。');
        conn.release();
    })
    .catch(err => {
        console.error('\n⚠️ [Database] MySQL 数据库连接失败！请检查宝塔数据库配置或数据库是否启动！');
        console.error(`错误详情: ${err.message}\n`);
    });

module.exports = pool;