#!/bin/bash
pkill -f "node.*factory-mes" 2>/dev/null
sleep 1
cd /home/dubin/factory-mes/server
nohup node server.js > data/mes.log 2>&1 &
echo "PID=$!"
sleep 2
curl -s http://127.0.0.1:3890/api/health
