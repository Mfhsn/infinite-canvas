#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ENV_FILE=${CANVAS_ENV_FILE:-$PROJECT_DIR/.env}
COMPOSE_SCRIPT=$PROJECT_DIR/docker/compose-cn.sh

if [ ! -f "$ENV_FILE" ]; then
    printf '%s\n' "Missing environment file: $ENV_FILE" >&2
    printf '%s\n' "Copy .env.example to .env and fill in production values first." >&2
    exit 1
fi

if [ ! -x "$COMPOSE_SCRIPT" ]; then
    printf '%s\n' "Compose helper is not executable: $COMPOSE_SCRIPT" >&2
    printf '%s\n' "Run: chmod +x docker/compose-cn.sh deploy-cn.sh" >&2
    exit 1
fi

read_env_value() {
    key=$1
    awk -v target="$key" '
        /^[[:space:]]*#/ { next }
        {
            line=$0
            sub(/^[[:space:]]*export[[:space:]]+/, "", line)
            split(line, parts, "=")
            name=parts[1]
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
            if (name == target) {
                sub(/^[^=]*=/, "", line)
                value=line
            }
        }
        END { print value }
    ' "$ENV_FILE"
}

base_path=$(read_env_value VITE_APP_BASE_PATH)
base_path=${base_path:-/}
public_access=$(read_env_value CANVAS_PUBLIC_ACCESS)
public_access=${public_access:-false}

case "$base_path" in
    /*/) ;;
    /) ;;
    *)
        printf '%s\n' "VITE_APP_BASE_PATH must start and end with /: $base_path" >&2
        exit 2
        ;;
esac

printf '%s\n' "[deploy] project: $PROJECT_DIR"
printf '%s\n' "[deploy] base path: $base_path"
printf '%s\n' "[deploy] public access: $public_access"

cd "$PROJECT_DIR"

printf '%s\n' '[deploy] building storage server...'
"$COMPOSE_SCRIPT" --profile build-artifacts run --rm storage-builder

printf '%s\n' '[deploy] building web application...'
"$COMPOSE_SCRIPT" --profile build-artifacts run --rm web-builder

# The production compose file bind-mounts build artifacts from the host. A
# successful container build is not enough if the mounted dist directory was
# not refreshed, so fail early with a concrete artifact check.
web_asset=$(sed -n 's/.*src="[^\"]*\/assets\/\([^\"]*\.js\)".*/\1/p' web/dist/index.html | head -n 1)
if [ -z "$web_asset" ] || [ ! -f "web/dist/assets/$web_asset" ]; then
    printf '%s\n' '[deploy] web build did not produce the asset referenced by web/dist/index.html' >&2
    exit 1
fi
if ! grep -q 'Platform session bootstrap' "web/dist/assets/$web_asset"; then
    printf '%s\n' '[deploy] web artifact is stale: missing current platform bootstrap diagnostics' >&2
    printf '%s\n' "[deploy] expected asset: web/dist/assets/$web_asset" >&2
    exit 1
fi
if [ ! -f storage-server/dist/server.js ] || ! grep -q 'exchange response validation failed' storage-server/dist/integration-client.js; then
    printf '%s\n' '[deploy] storage-server build artifact is missing or stale' >&2
    exit 1
fi

printf '%s\n' '[deploy] recreating application container...'
"$COMPOSE_SCRIPT" up -d --force-recreate --no-deps app

printf '%s\n' '[deploy] waiting for application health...'
attempt=1
while [ "$attempt" -le 30 ]; do
    if curl --fail --silent --show-error "http://127.0.0.1:3000${base_path}" -o /tmp/infinite-canvas-index.html 2>/dev/null \
        && grep -Fq "/assets/$web_asset" /tmp/infinite-canvas-index.html; then
        printf '%s\n' "[deploy] application is ready with current asset: http://127.0.0.1:3000${base_path}"
        exit 0
    fi
    sleep 2
    attempt=$((attempt + 1))
done

printf '%s\n' '[deploy] application did not become ready; recent logs:' >&2
"$COMPOSE_SCRIPT" logs --tail=100 app >&2 || true
exit 1
