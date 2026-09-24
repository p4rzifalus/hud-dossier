#!/bin/bash
# Двойной клик — запускает инструмент на http://localhost:8765 (нужно для камеры: браузеры
# дают доступ к камере только на https или localhost). Закройте это окно, чтобы остановить.
cd "$(dirname "$0")"
PORT=8765
echo "HUD Dossier: http://localhost:$PORT"
echo "Чтобы остановить — закройте это окно."
( sleep 1; open "http://localhost:$PORT/index.html" ) &
exec python3 -m http.server "$PORT" --bind 127.0.0.1
