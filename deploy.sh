#!/bin/sh
# Выкладка на Cloudflare Pages из чистой папки.
# wrangler заливает каталог целиком, поэтому собираем staging только из публичного:
# иначе в интернет уедут brand/, qr-tent/ и прочие рабочие файлы.
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

cp "$SRC/index.html" "$SRC/_headers" "$OUT/"
cp -R "$SRC/assets" "$SRC/functions" "$OUT/"

cd "$OUT"
npx --yes wrangler@4 pages deploy . --project-name sora-sushi --branch main --commit-dirty=true
