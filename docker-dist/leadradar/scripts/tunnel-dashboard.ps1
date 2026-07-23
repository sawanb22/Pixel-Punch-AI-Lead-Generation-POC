# Expose local LeadRadar dashboard via Cloudflare Tunnel (HTTPS).
# Prerequisite: dashboard running on localhost (default PORT=3000).
#
# Usage:
#   npm run dashboard:dev          # terminal 1
#   .\scripts\tunnel-dashboard.ps1 # terminal 2
#
# Quick tunnel (no Cloudflare account): random *.trycloudflare.com URL.
# For production, use a named tunnel + your domain — see docs/cloudflare-tunnel.md

$port = if ($env:PORT) { $env:PORT } else { "3000" }
$url = "http://localhost:$port"

Write-Host "Starting Cloudflare quick tunnel -> $url"
Write-Host "Share the https://*.trycloudflare.com URL with your partner."
Write-Host "Press Ctrl+C to stop the tunnel."
Write-Host ""

cloudflared tunnel --url $url
