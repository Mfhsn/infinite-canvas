#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")
ENV_FILE=${CANVAS_ENV_FILE:-$PROJECT_DIR/.env}

read_env_value() {
    key=$1
    [ -f "$ENV_FILE" ] || return 0
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

public_access=$(read_env_value CANVAS_PUBLIC_ACCESS | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')
case "$public_access" in
    1|true|yes|on)
        CANVAS_BIND_HOST=0.0.0.0
        printf '%s\n' '[docker] CANVAS_PUBLIC_ACCESS=true: port 3000 is publicly bound on 0.0.0.0' >&2
        ;;
    ''|0|false|no|off)
        CANVAS_BIND_HOST=127.0.0.1
        printf '%s\n' '[docker] CANVAS_PUBLIC_ACCESS=false: port 3000 is private on 127.0.0.1' >&2
        ;;
    *)
        printf '%s\n' "Invalid CANVAS_PUBLIC_ACCESS value: $public_access" >&2
        exit 2
        ;;
esac

export CANVAS_BIND_HOST
exec docker compose --env-file "$ENV_FILE" -f "$PROJECT_DIR/docker-compose.cn.yml" "$@"
