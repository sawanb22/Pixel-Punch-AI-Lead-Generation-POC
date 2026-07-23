# Use a lightweight base image with Python 3.11 and Node.js 22 LTS
FROM nikolaik/python-nodejs:python3.11-nodejs22-slim

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ca-certificates curl sqlite3 libsqlite3-dev procps git && \
    rm -rf /var/lib/apt/lists/*

# Set up environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV HERMES_HOME=/hermes_home
ENV PORT=3000
ENV LEADRADAR_AUTH_BYPASS=1
ENV LEADRADAR_DB=/app/data/leadradar.db
ENV PYTHONPATH=/hermes-agent
ENV SCORE_MOCK=0

# Create application directories
RUN mkdir -p /app /hermes-agent /hermes_home /app/data

# 1. Install Hermes Agent
WORKDIR /hermes-agent
COPY hermes-agent/ /hermes-agent/
# Install Python dependencies and build the package (with MCP support)
RUN pip install --no-cache-dir -e ".[mcp]"
# Install aiohttp separately — required by Hermes gateway api_server adapter
# Without this, Hermes runs in cron-only mode (no port 8642), breaking dashboard scoring
RUN pip install --no-cache-dir "aiohttp==3.14.1"



# 2. Set up LeadRadar Dashboard
WORKDIR /app
COPY leadradar/ /app/
# Install Node.js dependencies
RUN npm install --prefer-offline --no-audit

# 3. Bake config seed — start.sh copies this into the /hermes_home volume on first boot
# (cannot copy directly to /hermes_home as it's a named volume, wiped at runtime)
RUN mkdir -p /hermes_home_seed
COPY config.yaml /hermes_home_seed/config.yaml


# 4. Add Entrypoint Script
COPY start.sh /start.sh
RUN chmod +x /start.sh

# Expose ports
# 3000: LeadRadar Dashboard
# 8642: Hermes Gateway API
EXPOSE 3000 8642

ENTRYPOINT ["/start.sh"]
