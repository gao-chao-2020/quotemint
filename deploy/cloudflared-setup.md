# QuoteMint via Cloudflare Tunnel

Goal: https://quotemint.dpdns.org -> http://127.0.0.1:3000. No open inbound ports, no ICP filing.

## 1. Put the domain on Cloudflare (once)
1. dash.cloudflare.com -> Add a site -> your dpdns.org subdomain (e.g. quotemint.dpdns.org) -> Free plan.
2. Cloudflare shows two nameservers. At dash.domain.digitalplat.org, set that domain's NS records to those two.
3. Wait until the zone shows Active (minutes to a few hours).

## 2. Install cloudflared on the server (Cloudflare's own repo, CN-reachable)
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared
cloudflared --version

## 3. Authorize and create the tunnel
sudo cloudflared tunnel login
# Open the printed URL in a browser, pick the quotemint zone, Authorize.
# Headless server: the browser downloads cert.pem; copy it to /root/.cloudflared/cert.pem
sudo cloudflared tunnel create quotemint
# Prints a tunnel UUID. Credentials file: /root/.cloudflared/<UUID>.json

## 4. Route DNS to the tunnel
sudo cloudflared tunnel route dns quotemint quotemint.dpdns.org

## 5. Run it as a service
sudo mkdir -p /etc/cloudflared
sudo tee /etc/cloudflared/config.yml >/dev/null <<'EOF'
tunnel: quotemint
credentials-file: /root/.cloudflared/<UUID>.json
ingress:
  - hostname: quotemint.dpdns.org
    service: http://127.0.0.1:3000
  - service: http_status:404
EOF
# Replace <UUID> with the value from step 3.
sudo cloudflared service install
sudo systemctl enable --now cloudflared

## 6. Verify
curl -I https://quotemint.dpdns.org/healthz        # expect: HTTP/2 200
systemctl status cloudflared --no-pager
journalctl -u cloudflared -n 20 --no-pager

## Notes
- The app .env already sets TRUST_PROXY=1, so rate limiting sees real client IPs.
- Only outbound connections are used; keep the server firewall closed.
- BASE_URL must be https://quotemint.dpdns.org (quote links are built from it).
