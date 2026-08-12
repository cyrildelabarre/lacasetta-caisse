#!/usr/bin/env bash
# Génère dist/ : les fichiers front MINIFIÉS, prêts à uploader via FileZilla sur
# lacasetta.pizza. À relancer après chaque modif de app.js / style.css / index.html
# / sw.js. Nécessite Node (npx télécharge esbuild au 1er appel).
#
#   bash build-dist.sh
#
set -euo pipefail
cd "$(dirname "$0")"

ESBUILD="npx --yes esbuild@0.23.1"
rm -rf dist && mkdir -p dist

echo "→ JS / CSS (esbuild, sans renommage d'identifiants pour ne rien casser)…"
$ESBUILD app.js    --minify-whitespace --minify-syntax --charset=utf8 --outfile=dist/app.js    --log-level=warning
$ESBUILD sw.js     --minify-whitespace --minify-syntax --charset=utf8 --outfile=dist/sw.js     --log-level=warning
$ESBUILD style.css --minify --charset=utf8 --outfile=dist/style.css --log-level=warning

echo "→ index.html + manifest.json…"
node build-html.js
node -e "const fs=require('fs');fs.writeFileSync('dist/manifest.json',JSON.stringify(JSON.parse(fs.readFileSync('manifest.json','utf8'))))"

echo "→ icônes…"
cp icon-192.png icon-512.png apple-touch-icon.png dist/

echo "→ contrôle syntaxe JS minifié…"
node --check dist/app.js
node --check dist/sw.js

echo "✅ dist/ prêt. Uploade le CONTENU de dist/ via FileZilla."
