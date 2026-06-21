# ZotExtract clickable Zotero test capsule.
# Build with: docker buildx build --platform linux/amd64 ...
# Runtime is intentionally local-only: no published ports, normally --network none.
FROM node:22-bookworm-slim

ARG ZOTERO_VERSION=7.0.15
ENV DEBIAN_FRONTEND=noninteractive \
    ZOTERO_VERSION=${ZOTERO_VERSION} \
    ZOTERO_HOME=/opt/zotero \
    DISPLAY=:99 \
    NODE_ENV=test

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    bzip2 \
    xz-utils \
    unzip \
    zip \
    xvfb \
    xauth \
    x11-utils \
    xdotool \
    wmctrl \
    x11vnc \
    fluxbox \
    scrot \
    dbus-x11 \
    libgtk-3-0 \
    libdbus-glib-1-2 \
    libxt6 \
    libx11-xcb1 \
    libasound2 \
    libnss3 \
    libxss1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    fonts-dejavu \
    procps \
    file \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    case "$ZOTERO_VERSION" in \
      7.*) ZOTERO_ARCHIVE="Zotero-${ZOTERO_VERSION}_linux-x86_64.tar.bz2" ;; \
      *) ZOTERO_ARCHIVE="Zotero-${ZOTERO_VERSION}_linux-x86_64.tar.xz" ;; \
    esac; \
    mkdir -p /opt \
    && curl -fsSL "https://download.zotero.org/client/release/${ZOTERO_VERSION}/${ZOTERO_ARCHIVE}" -o "/tmp/${ZOTERO_ARCHIVE}" \
    && tar -xf "/tmp/${ZOTERO_ARCHIVE}" -C /opt \
    && mv /opt/Zotero_linux-x86_64 "$ZOTERO_HOME" \
    && rm "/tmp/${ZOTERO_ARCHIVE}" \
    && file "$ZOTERO_HOME/zotero-bin"

WORKDIR /workspace
COPY scripts/run-zotero-container-smoke.sh /usr/local/bin/run-zotero-container-smoke
RUN chmod +x /usr/local/bin/run-zotero-container-smoke

CMD ["run-zotero-container-smoke"]
