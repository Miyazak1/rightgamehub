#!/bin/sh
set -eu

cd "$(dirname "$0")"
ENV_FILE=${ENV_FILE:-.env.prod}
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing deploy/$ENV_FILE. Copy .env.prod.example and fill every required value." >&2
  exit 1
fi

set -a
. "./$ENV_FILE"
set +a
for name in APP_DOMAIN RUNTIME_DOMAIN ACME_EMAIL CLOUDFLARE_API_TOKEN POSTGRES_PASSWORD OTP_HMAC_KEY MAIL_FROM RESEND_API_KEY; do
  eval "value=\${$name:-}"
  if [ -z "$value" ] || echo "$value" | grep -qi 'replace'; then
    echo "$name is missing or still uses an example value." >&2
    exit 1
  fi
done

docker compose --env-file "$ENV_FILE" -f compose.prod.yml config >/dev/null
docker compose --env-file "$ENV_FILE" -f compose.prod.yml up -d --build --remove-orphans
docker compose --env-file "$ENV_FILE" -f compose.prod.yml ps
echo "GameHub deployment submitted. Check: https://$APP_DOMAIN/ready"
