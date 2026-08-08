# Perch — headless monitoring/tools server in a container.
# Note: desktop-integration features (brightness, wallpaper, bluetooth,
# notifications, opening apps) only work in the native/.deb install on the host.
FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir ".[office]"

ENV PERCH_HOST=0.0.0.0 \
    PERCH_PORT=9080
EXPOSE 9080

# Token is created on first run and printed to the logs.
CMD ["python", "-m", "perch"]
