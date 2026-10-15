#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ZOTERO_VERSION="${ZOTERO_VERSION:-7.0.15}"
IMAGE="${IMAGE:-zotextract-zotero-test:${ZOTERO_VERSION}}"
PLATFORM="${PLATFORM:-linux/amd64}"
HOST_ARTIFACTS="${ARTIFACTS:-$ROOT/test-artifacts/docker-zotero-${ZOTERO_VERSION}}"
CONTAINER_ARTIFACTS="${CONTAINER_ARTIFACTS:-/workspace/test-artifacts/docker-zotero-${ZOTERO_VERSION}}"
mkdir -p "$HOST_ARTIFACTS"

DOCKER_BIN="${DOCKER_BIN:-docker}"
if ! "$DOCKER_BIN" version >/dev/null 2>&1 && command -v docker.exe >/dev/null 2>&1; then
  DOCKER_BIN="docker.exe"
fi
if ! "$DOCKER_BIN" info >/dev/null 2>&1; then
  echo "Docker CLI is available, but the Docker engine is not reachable." >&2
  echo "Start Docker Desktop or enable its WSL integration, then rerun npm run test:zotero:docker." >&2
  "$DOCKER_BIN" info >&2 || true
  exit 2
fi

DOCKER_ROOT="$ROOT"
DOCKERFILE="$ROOT/docker/zotero-test/Dockerfile"
DOCKER_NETWORK_NAME="${DOCKER_NETWORK_NAME:-}"
DOCKER_GPUS="${DOCKER_GPUS:-}"
if [[ "$DOCKER_BIN" == *".exe" ]]; then
  if command -v cygpath >/dev/null 2>&1; then
    DOCKER_ROOT="$(cygpath -w "$ROOT")"
    DOCKERFILE="$(cygpath -w "$ROOT/docker/zotero-test/Dockerfile")"
  elif command -v wslpath >/dev/null 2>&1; then
    DOCKER_ROOT="$(wslpath -w "$ROOT")"
    DOCKERFILE="$(wslpath -w "$ROOT/docker/zotero-test/Dockerfile")"
  fi
fi

# Build may need binfmt/qemu support on ARM64 hosts.
"$DOCKER_BIN" buildx build --load --platform "$PLATFORM" --build-arg "ZOTERO_VERSION=$ZOTERO_VERSION" -f "$DOCKERFILE" -t "$IMAGE" "$DOCKER_ROOT"

DOCKER_NETWORK_ARGS=(--network none)
if [[ -n "${DOCKER_NETWORK_NAME}" ]]; then
  DOCKER_NETWORK_ARGS=(--network "$DOCKER_NETWORK_NAME")
elif [[ "${WATCH_UI:-0}" == "1" || "${ZOTEXTRACT_REAL_PROVIDER:-0}" == "1" ]]; then
  DOCKER_NETWORK_ARGS=(--network bridge)
fi
DOCKER_PORT_ARGS=()
DOCKER_HOST_ARGS=()
DOCKER_GPU_ARGS=()
if [[ -n "${DOCKER_GPUS}" ]]; then
  if [[ "$DOCKER_GPUS" == "all" || "$DOCKER_GPUS" == "1" ]]; then
    DOCKER_GPU_ARGS=(--gpus all)
  else
    DOCKER_GPU_ARGS=(--gpus "$DOCKER_GPUS")
  fi
fi
if [[ "${WATCH_UI:-0}" == "1" ]]; then
  # Opt-in only. Bind to loopback so the Zotero desktop is visible from this machine, not the LAN.
  DOCKER_PORT_ARGS=(-p "127.0.0.1:${VNC_PORT:-5901}:5900")
  echo "WATCH_UI=1: connect a VNC viewer to 127.0.0.1:${VNC_PORT:-5901} while the test runs." >&2
fi
if [[ "${ZOTEXTRACT_ALLOW_HOST_PROVIDER:-0}" == "1" || "${ZOTEXTRACT_PROVIDER_BASE_URL:-}" == *"host.docker.internal"* ]]; then
  DOCKER_HOST_ARGS=(--add-host=host.docker.internal:host-gateway)
fi

DOCKER_RUN_ENV=()
DOCKER_USER_ARGS=(--user "$(id -u):$(id -g)")
WINDOWS_DOCKER_MOUNT=0
if [[ "$DOCKER_BIN" == *".exe" || -n "${MSYSTEM:-}" || "$ROOT" == /c/* || "$ROOT" == /mnt/* ]]; then
  WINDOWS_DOCKER_MOUNT=1
fi
if [[ "$WINDOWS_DOCKER_MOUNT" == "1" ]]; then
  # Git Bash/MSYS otherwise rewrites container paths such as /workspace and
  # /tmp/zotextract-home before docker.exe sees them. Host paths are converted
  # above, so it is safe to disable conversion for the Docker invocation.
  DOCKER_RUN_ENV=(env MSYS2_ARG_CONV_EXCL="*" MSYS_NO_PATHCONV=1)
  # Docker Desktop bind mounts from Windows are writable as the default
  # container user, while arbitrary Git Bash numeric UIDs can be denied.
  DOCKER_USER_ARGS=()
fi

# Zotero 8+ needs user-namespace clone syscalls for its browser sandbox.
# Keep Linux capabilities dropped, but relax Docker's default seccomp filter.
"${DOCKER_RUN_ENV[@]}" "$DOCKER_BIN" run --rm \
  --platform "$PLATFORM" \
  "${DOCKER_USER_ARGS[@]}" \
  --env HOME=/tmp/zotextract-home \
  --env XDG_RUNTIME_DIR=/tmp/zotextract-runtime \
  --env WATCH_UI="${WATCH_UI:-0}" \
  --env WATCH_PAUSE_SECONDS="${WATCH_PAUSE_SECONDS:-20}" \
  --env UI_WALKTHROUGH="${UI_WALKTHROUGH:-1}" \
  --env ZOTEXTRACT_INCLUDE_E2E=1 \
  --env ZOTEXTRACT_SKIP_UNIT_TESTS="${ZOTEXTRACT_SKIP_UNIT_TESTS:-0}" \
  --env ZOTEXTRACT_REAL_PROVIDER="${ZOTEXTRACT_REAL_PROVIDER:-0}" \
  --env ZOTEXTRACT_ALLOW_HOST_PROVIDER="${ZOTEXTRACT_ALLOW_HOST_PROVIDER:-0}" \
  --env ZOTEXTRACT_PROVIDER_NAME="${ZOTEXTRACT_PROVIDER_NAME:-}" \
  --env ZOTEXTRACT_PROVIDER_MODEL="${ZOTEXTRACT_PROVIDER_MODEL:-}" \
  --env ZOTEXTRACT_PROVIDER_BASE_URL="${ZOTEXTRACT_PROVIDER_BASE_URL:-}" \
  --env ZOTEXTRACT_PROVIDER_API_KEY="${ZOTEXTRACT_PROVIDER_API_KEY:-}" \
  --env ZOTEXTRACT_PROVIDER_TIMEOUT_SECONDS="${ZOTEXTRACT_PROVIDER_TIMEOUT_SECONDS:-}" \
  --env XVFB_SCREEN="${XVFB_SCREEN:-2560x1440x24}" \
  --env ZOTEXTRACT_PROVIDER_SYSTEM_PROMPT="${ZOTEXTRACT_PROVIDER_SYSTEM_PROMPT:-}" \
  --env ZOTEXTRACT_PROVIDER_REASONING_EFFORT="${ZOTEXTRACT_PROVIDER_REASONING_EFFORT:-}" \
  --env ZOTEXTRACT_E2E_FIXTURE_MANIFEST="${ZOTEXTRACT_E2E_FIXTURE_MANIFEST:-}" \
  --env ZOTEXTRACT_E2E_DIRECT_SESSION_START="${ZOTEXTRACT_E2E_DIRECT_SESSION_START:-0}" \
  --env ZOTERO_VERSION="$ZOTERO_VERSION" \
  --env ARTIFACTS="$CONTAINER_ARTIFACTS" \
  "${DOCKER_NETWORK_ARGS[@]}" \
  "${DOCKER_PORT_ARGS[@]}" \
  "${DOCKER_HOST_ARGS[@]}" \
  "${DOCKER_GPU_ARGS[@]}" \
  --cap-drop ALL \
  --security-opt seccomp=unconfined \
  --pids-limit 512 \
  --memory "${ZOTERO_DOCKER_MEMORY:-4g}" \
  --cpus "${ZOTERO_DOCKER_CPUS:-4}" \
  -v "$DOCKER_ROOT:/workspace" \
  -w /workspace \
  "$IMAGE"
