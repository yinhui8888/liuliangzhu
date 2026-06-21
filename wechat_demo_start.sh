PATH=/www/server/nodejs/v20.20.0/bin:/bin:/sbin:/usr/bin:/usr/sbin:/usr/local/bin:/usr/local/sbin:~/bin
export PATH

export 
export NODE_PROJECT_NAME="wechat_demo"
cd /www/wwwroot/wechat-demo
nohup /www/server/nodejs/v20.20.0/bin/node /www/wwwroot/wechat-demo/app.js  &>> /www/wwwlogs/nodejs/wechat_demo.log &
echo $! > /www/server/nodejs/vhost/pids/wechat_demo.pid
