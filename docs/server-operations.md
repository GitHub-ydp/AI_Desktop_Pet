# Server Operations

## Server

- Host: `43.161.234.23`
- OS: Ubuntu 24.04
- Login user: `ubuntu`
- Domain: `aisoulpal.com`, `www.aisoulpal.com`
- Auth:
  - Current daily login method is password login
  - Do not store the password in this repo
  - The old `C:\Users\Administrator\Desktop\aws\ai_0224.pem` is not for this server

## Site Layout

- Web project local path: `C:\Users\Administrator\Desktop\jizhang\web`
- Nginx live root: `/var/www/jizhang-web/current`
- Release uploads: `/home/ubuntu/jizhang-web-releases`
- Nginx site config: `/etc/nginx/sites-enabled/default`
- SSL cert dir: `/etc/nginx/ssl/aisoulpal.com`
  - Full chain: `/etc/nginx/ssl/aisoulpal.com/fullchain.pem`
  - Private key: `/etc/nginx/ssl/aisoulpal.com/privkey.pem`

## Current Behavior

- `http://aisoulpal.com` and `http://www.aisoulpal.com` redirect to HTTPS
- `https://aisoulpal.com` serves the Vite static site
- `https://www.aisoulpal.com` uses the same certificate and site config

## Deploy Web Updates

### 1. Build locally

Run from the repo root:

```powershell
cd C:\Users\Administrator\Desktop\jizhang\web
npm run build
```

Build output goes to:

```text
C:\Users\Administrator\Desktop\jizhang\web\dist
```

### 2. Upload a new release

Open SSH:

```powershell
ssh ubuntu@43.161.234.23
```

Create a timestamped release directory on the server:

```bash
mkdir -p /home/ubuntu/jizhang-web-releases/20260312-120000
```

From local Windows shell, upload the built files:

```powershell
scp -r C:\Users\Administrator\Desktop\jizhang\web\dist\* ubuntu@43.161.234.23:/home/ubuntu/jizhang-web-releases/20260312-120000/
```

### 3. Switch live content

After SSH login:

```bash
sudo rm -rf /var/www/jizhang-web/current
sudo mkdir -p /var/www/jizhang-web/current
sudo cp -a /home/ubuntu/jizhang-web-releases/20260312-120000/. /var/www/jizhang-web/current/
sudo chown -R www-data:www-data /var/www/jizhang-web
sudo nginx -t
sudo systemctl reload nginx
```

## Verify

On the server:

```bash
curl -I http://127.0.0.1 -H "Host: aisoulpal.com"
curl -I https://127.0.0.1 -k -H "Host: aisoulpal.com"
```

Expected:

- HTTP returns `301`
- HTTPS returns `200`

From local machine:

```powershell
curl.exe -I http://aisoulpal.com
curl.exe -I https://aisoulpal.com
curl.exe -I https://www.aisoulpal.com
```

Expected:

- `http://aisoulpal.com` -> `301`
- `https://aisoulpal.com` -> `200`
- `https://www.aisoulpal.com` -> `200`

## Nginx Operations

Check config:

```bash
sudo nginx -t
```

Reload after config/content changes:

```bash
sudo systemctl reload nginx
```

Check service:

```bash
sudo systemctl status nginx --no-pager --lines=20
```

Check listeners:

```bash
ss -tlnp | grep -E ":(80|443)\s"
```

Logs:

```bash
sudo tail -n 50 /var/log/nginx/access.log
sudo tail -n 50 /var/log/nginx/error.log
```

## SSL Certificate Updates

Local certificate package currently used:

```text
C:\Users\Administrator\Desktop\jizhang\web\aisoulpal.com_nginx.zip
```

Expanded local files:

```text
C:\Users\Administrator\Desktop\jizhang\web\aisoulpal.com_nginx_unzipped\aisoulpal.com_nginx
```

Server certificate target paths:

- `/etc/nginx/ssl/aisoulpal.com/fullchain.pem`
- `/etc/nginx/ssl/aisoulpal.com/privkey.pem`

After replacing cert files:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## DNS Notes

- DNS panel may show `43.161.234.23`, but always verify the actual public answer
- Useful checks:

```powershell
Resolve-DnsName aisoulpal.com -Type A
Resolve-DnsName www.aisoulpal.com -Type A
nslookup aisoulpal.com cygnet.dnspod.net
nslookup www.aisoulpal.com cygnet.dnspod.net
```

- If HTTP works but HTTPS times out, check:
  - Security group / firewall has `443` open
  - Domain is actually resolving to the expected target
  - Any DNSPod or upstream forwarding layer is not intercepting TLS incorrectly

## Known Backups

Recent nginx config backups on server:

- `/home/ubuntu/default.bak-20260312-105936`
- `/home/ubuntu/default.pre-ssl-20260312-111105.bak`
- `/home/ubuntu/default.pre-http-restore-20260312-112332.bak`
- `/home/ubuntu/default.pre-https-redirect-20260312-113913.bak`
