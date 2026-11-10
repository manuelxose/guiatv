#!/usr/bin/env bash
# M15 first article: one manual generation request through the normal path, then a manual runner start.
# Run on the server: ssh contabo 'bash -s' < scripts/ops/editorial-first-article.sh   (never prints the admin key)
set -euo pipefail
KEY=$(grep -E '^ANALYTICS_ADMIN_KEY=' /etc/guiatv/api.env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
API=http://127.0.0.1:4000/v2/admin/editorial/generation
post() { curl -sS -m 60 -X POST -H "x-admin-key: ${KEY}" -H 'content-type: application/json' -d "$2" "$API/$1"; echo; }
post requests '{
  "title": "Publicidad de apuestas en televisión: en qué horario está permitida en España",
  "slug": "publicidad-apuestas-television-horario-permitido-espana",
  "topic": "Horario legal de la publicidad de juego y apuestas en la televisión en España según el Real Decreto 958/2020",
  "intent": "Saber a qué horas pueden emitirse anuncios de apuestas y juego en la televisión y qué excepciones fija la norma",
  "category": "Televisión", "volatility": "stable", "contentType": "guide", "length": "short",
  "seedUrls": ["https://www.boe.es/buscar/act.php?id=BOE-A-2020-13495", "https://www.cnmc.es/prensa/informe-decreto-actividades-juego-comunicaciones-comerciales-cnmc-20200526"],
  "internalSources": [{ "id": "anuncios", "url": "/guias/limite-anuncios-television-minutos-por-hora-ley" }, { "id": "menores", "url": "/guias/horario-proteccion-menores-television-calificacion-por-edades" }]
}'
post runner/process/start '{"mode":"manual"}'
