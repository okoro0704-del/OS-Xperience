#!/bin/sh
set -eu
PORT="${PORT:-8080}"
sed "s/PORT_PLACEHOLDER/${PORT}/g" /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g "daemon off;"
