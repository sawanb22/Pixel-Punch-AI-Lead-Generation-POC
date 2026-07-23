#!/bin/bash
set -e

# ── 1. Seed the database volume on first boot ─────────────────────────────────
if [ ! -f /app/data/leadradar.db ]; then
    echo "First boot: seeding database from baked template..."
    mkdir -p /app/data
    cp /app/leadradar.db /app/data/leadradar.db
    echo "Database seeded successfully."
fi

# ── 2. Seed Hermes config on first boot (volume starts empty) ─────────────────
if [ ! -f /hermes_home/config.yaml ]; then
    echo "First boot: seeding Hermes config from baked template..."
    mkdir -p /hermes_home
    cp /hermes_home_seed/config.yaml /hermes_home/config.yaml
    echo "Hermes config seeded successfully."
fi

# Dynamically apply BIFROST_BASE_URL from .env if specified
if [ -n "$BIFROST_BASE_URL" ] && [ -f /hermes_home/config.yaml ]; then
    echo "Configuring Bifrost base_url: $BIFROST_BASE_URL"
    sed -i "s|base_url:.*|base_url: $BIFROST_BASE_URL|g" /hermes_home/config.yaml
fi

# ── 3. Start Hermes Gateway in the background ─────────────────────────────────
echo "Starting Hermes Gateway..."
hermes gateway run &
HERMES_PID=$!

# Give Hermes a few seconds to initialize before dashboard starts
sleep 5

# ── 4. Start LeadRadar Dashboard ──────────────────────────────────────────────
echo "Starting LeadRadar Dashboard..."
cd /app
npm run dashboard &
DASHBOARD_PID=$!

# ── 5. Trap shutdown signals and propagate to child processes ─────────────────
cleanup() {
    echo "Shutting down..."
    kill -TERM "$HERMES_PID" 2>/dev/null || true
    kill -TERM "$DASHBOARD_PID" 2>/dev/null || true
    wait "$HERMES_PID" 2>/dev/null || true
    wait "$DASHBOARD_PID" 2>/dev/null || true
    exit 0
}

trap cleanup SIGINT SIGTERM

# Keep the script alive
wait "$DASHBOARD_PID" "$HERMES_PID"
