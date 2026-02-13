FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    npm install -g tsx && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY requirements-sandbox.txt /tmp/req.txt
RUN pip install --no-cache-dir -r /tmp/req.txt && rm /tmp/req.txt

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && \
    useradd -m -s /bin/bash sandbox && \
    mkdir -p /workspace /tmp/sandbox && \
    chown sandbox:sandbox /workspace /tmp/sandbox

USER sandbox
WORKDIR /workspace
ENTRYPOINT ["/entrypoint.sh"]
