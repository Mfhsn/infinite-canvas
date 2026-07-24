#!/bin/sh
set -eu

ENV_JS=${INFINITE_CANVAS_ENV_JS:-${STATIC_DIR:-/usr/share/nginx/html}/env.js}

env_json_string() {
    printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\r//g'
}

write_env_var() {
    key=$1
    value=$(printenv "$key" 2>/dev/null || true)
    [ -n "$value" ] || return 0
    printf '  %s: "%s",\n' "$key" "$(env_json_string "$value")"
}

integration_enabled=false
case "$(printenv INTEGRATION_ENABLED 2>/dev/null | tr '[:upper:]' '[:lower:]' || true)" in
    1|true) integration_enabled=true ;;
esac

{
    printf 'window.__INFINITE_CANVAS_ENV__ = {\n'
    for key in \
        VITE_DOC_URL \
        VITE_AI_CONFIG_OVERRIDE \
        VITE_AI_CHANNELS_JSON \
        VITE_AI_CHANNEL_ID \
        VITE_AI_CHANNEL_NAME \
        VITE_AI_API_FORMAT \
        VITE_AI_BASE_URL \
        VITE_AI_LLM_URL \
        VITE_AI_LLM_PLATFORM_CODE \
        VITE_AI_API_KEY \
        VITE_AI_PLATFORM_ID \
        VITE_AI_MODELS \
        VITE_SHOW_IMAGE_WORKBENCH \
        VITE_SHOW_VIDEO_WORKBENCH \
        VITE_SHOW_GITHUB \
        VITE_SHOW_DOCS \
        VITE_SHOW_CONFIG \
        VITE_SHOW_SHORTCUTS \
        VITE_AI_TASK_TIMEOUT_MS \
        VITE_DEFAULT_IMAGE_MODEL \
        VITE_DEFAULT_VIDEO_MODEL \
        VITE_DEFAULT_TEXT_MODEL \
        VITE_DEFAULT_AUDIO_MODEL \
        VITE_DEFAULT_SYSTEM_PROMPT \
        VITE_DEFAULT_IMAGE_SIZE \
        VITE_DEFAULT_IMAGE_QUALITY \
        VITE_DEFAULT_IMAGE_COUNT \
        VITE_DEFAULT_CANVAS_IMAGE_COUNT \
        VITE_DEFAULT_VIDEO_SECONDS \
        VITE_DEFAULT_VIDEO_QUALITY \
        VITE_DEFAULT_AUDIO_VOICE \
        VITE_DEFAULT_AUDIO_FORMAT \
        VITE_DEFAULT_AUDIO_SPEED
    do
        if [ "$integration_enabled" = true ] && { [ "$key" = VITE_AI_API_KEY ] || [ "$key" = VITE_AI_CHANNELS_JSON ]; }; then
            continue
        fi
        write_env_var "$key"
    done
    printf '};\n'
} > "$ENV_JS"

if [ "$#" -gt 0 ]; then
    exec "$@"
fi
