FROM python:3.11-slim-trixie AS renderer
ARG TARGETARCH

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
    case "$TARGETARCH" in \
        amd64) arch=x86_64; checksum=21bd8ab3b6834c48fcebca390e3d3f79dcedd6a4388e4eeaf802501f84fcf433 ;; \
        arm64) arch=aarch64; checksum=3c721f2548c4c74aba2ffb38fa09888d15610edaecc9fe33f81b1d7c42d222e4 ;; \
        *) echo "Unsupported hwp-cli architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    mkdir /opt/hwp-cli; \
    archive="hwp-v1.3.1-$arch-unknown-linux-gnu.tar.gz"; \
    curl --fail --show-error --silent --location --output /tmp/hwp.tar.gz \
        "https://github.com/STAIxBWLB/agent-hwp/releases/download/v1.3.1/$archive"; \
    echo "$checksum  /tmp/hwp.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/hwp.tar.gz --no-same-owner -C /opt/hwp-cli

FROM python:3.11-slim-trixie
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    YEONIEUM_HWP_RENDERER=/opt/hwp-cli/hwp
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-noto-cjk libgcc-s1 \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -o 10001 -g 10001 -m 0700 /var/lib/yeonieum \
    && touch /var/lib/yeonieum/.volume
COPY --from=renderer /opt/hwp-cli/ /opt/hwp-cli/
COPY requirements-lock.txt .
RUN pip install --no-cache-dir -r requirements-lock.txt \
    && "$YEONIEUM_HWP_RENDERER" --version
COPY src/ src/

USER 10001:10001
CMD ["python", "-m", "uvicorn", "yeonieum.main:create_app", "--factory", "--app-dir", "src", "--host", "0.0.0.0", "--port", "8180"]
