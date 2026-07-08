#!/bin/bash
# Factory MES - startup script
cd /home/dubin/factory-mes
exec /home/dubin/.local/bin/node server.js >> data/mes.log 2>&1
