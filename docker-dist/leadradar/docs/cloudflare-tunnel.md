# Cloudflare Tunnel — share the dashboard over HTTPS

Expose your local LeadRadar dashboard so a partner can open it in a browser without port forwarding or a static IP.

## Quick share (no Cloudflare account)

Best for demos and short sessions. URL changes each time you restart the tunnel.

**Terminal 1 — dashboard**

```powershell
npm run dashboard:dev
```

**Terminal 2 — tunnel**

```powershell
.\scripts\tunnel-dashboard.ps1
```

Or directly:

```powershell
cloudflared tunnel --url http://localhost:3000
```

Copy the `https://….trycloudflare.com` URL from the tunnel output and send it to your partner.

### Auth with quick tunnel

Your dev setup uses `LEADRADAR_AUTH_BYPASS=1`, so **anyone with the link** can use the dashboard as `dev@local`. Only share the URL privately, and stop the tunnel when you are done.

For safer sharing, turn off bypass and use Google OAuth (see below).

## Safer sharing (Google OAuth + allowlist)

1. Do **not** set `LEADRADAR_AUTH_BYPASS` when tunneling.
2. In [Google Cloud Console](https://console.cloud.google.com/), add your tunnel callback to **Authorized redirect URIs**:
   - Quick tunnel: `https://YOUR-SUBDOMAIN.trycloudflare.com/auth/google/callback`
   - Named tunnel: `https://dashboard.yourdomain.com/auth/google/callback`
3. Set in `.env`:

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=https://YOUR-TUNNEL-HOST/auth/google/callback
LEADRADAR_ALLOWLIST=you@company.com,partner@company.com
SESSION_SECRET=long-random-string
```

4. Restart the dashboard (without auth bypass):

```powershell
npm run dashboard
```

5. Start the tunnel and share the HTTPS URL. Your partner signs in with Google; only allowlisted emails get in.

## Named tunnel (stable URL, production)

Requires a free Cloudflare account and a domain on Cloudflare.

1. Log in: `cloudflared tunnel login`
2. Create: `cloudflared tunnel create leadradar`
3. Add a DNS CNAME in Cloudflare pointing to the tunnel (e.g. `dashboard.yourdomain.com`).
4. Config file `%USERPROFILE%\.cloudflared\config.yml`:

```yaml
tunnel: <TUNNEL-UUID>
credentials-file: C:\Users\<you>\.cloudflared\<TUNNEL-UUID>.json

ingress:
  - hostname: dashboard.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

5. Run: `cloudflared tunnel run leadradar`

Update `GOOGLE_CALLBACK_URL` to match your stable hostname.

## Requirements

- Dashboard listening on `PORT` (default `3000`)
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/downloads/) installed (`winget install Cloudflare.cloudflared`)
- For scoring/enrichment over the tunnel, Hermes and other backends must still be reachable from **your** machine (the tunnel only forwards the dashboard HTTP port)

## Troubleshooting

| Issue | Fix |
|-------|-----|
| 502 / connection refused | Start `npm run dashboard:dev` first |
| OAuth redirect mismatch | `GOOGLE_CALLBACK_URL` must exactly match Google Console + tunnel host |
| Session lost on refresh | Set a strong `SESSION_SECRET`; quick tunnel URLs change each run |
| Partner sees empty scoring | Hermes runs locally — ensure `hermes gateway run` is up on your PC |
