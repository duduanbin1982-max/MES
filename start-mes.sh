#!/bin/bash
cd /home/dubin/factory-mes/server
exec /home/dubin/.local/bin/node server.js >> /home/dubin/factory-mes/server/data/mes.log 2>&1