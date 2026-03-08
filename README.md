# Heliactyl Next (Toledo)

The all-in-one dashboard built from the legacy of Heliactyl. A high performance user interface, full built-in panel for managing servers, coins system, resources store and more.

## Required: Edit your Wings configuration

**Before deploying Heliactyl Next, you must configure each node's Wings configuration!**

1. On each node, edit the Wings configuration file (usually at `/etc/pterodactyl/config.yml`)
2. Locate the `allowed-origins` section
3. Change:
   ```yaml
   allowed-origins: []
   ```
   to either:
   ```yaml
   allowed-origins: ['*']  # recommended for simplicity
   ```
   or:
   ```yaml
   allowed-origins: ['https://your-dashboard-domain.com']  # more restrictive option
   ```

If you don't do this, Heliactyl Next can't communicate with your nodes.

## Features

- Modern, responsive user interface
- Built-in panel, goodbye Pterodactyl
- Integrated coins/credits system
- User/password authentication
- Resource allocation system
- Real-time stats and charts
- Support tickets *(pending reimplementation)*
- Admin area with users, nodes and more

## Prerequisites

- **Node.js v18+** (Required for both frontend and backend)
- **Redis**
- **Nginx**
- SSL certificate (recommended)
- *Optional: Bun v1.1.42+ (You can use Bun instead of Node.js for the backend if preferred)*

## 1. Prerequisites Installation

1. Install Redis:
```bash
# For Ubuntu/Debian
sudo apt update
sudo apt install redis-server

# For CentOS/RHEL
sudo dnf install epel-release
sudo dnf install redis

# Start and enable Redis
sudo systemctl start redis
sudo systemctl enable redis
```

2. Install Node.js & NPM:
*Find how to install Node.js via https://nodejs.org or via NVM.*

*(Optional) Install Bun if you prefer it for the backend:*
```bash
curl -fsSL https://bun.sh/install | bash
bun upgrade --canary
source ~/.bashrc
```

## 2. Heliactyl Next Installation

1. Clone the repository:
```bash
git clone https://github.com/re-heliactyl/Toledo
cd Toledo
```

2. Install backend dependencies:
```bash
cd server
npm install
# Or use 'bun install' or 'pnpm install'
```

3. Create configuration file:
```bash
cp example_config.toml config.toml
```

4. Configure your `config.toml` file with your database and Pterodactyl details.

5. Build Frontend & Start Heliactyl Next:
```bash
# Optional: If you haven't installed frontend dependencies yet
# cd ../frontend && pnpm install && cd ../server

# Build the frontend using the server's mono script
npm run mono:build

# Start the app
npm start
# Or manually: node --no-deprecation app.js (or bun run app.js)
```
## Nginx Configuration 

This is required to host Heliactyl Next on a public URL.

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name dashboard.yourdomain.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name dashboard.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # HSTS (uncomment if you're using HTTPS)
    # add_header Strict-Transport-Security "max-age=63072000" always;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Cache static assets (filenames contain hashes, so immutable is safe)
    location /assets/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # WebSocket support
    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket specific settings
        proxy_read_timeout 86400;    # Prevents timeout for long-lived connections
        proxy_send_timeout 86400;    # Prevents timeout for long-lived connections
        proxy_buffering off;         # Disable buffering for real-time communication
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    
    # Optimize SSL
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;
}
```

## Geographic Load Balancing (Optional)

Route users to the nearest Heliactyl instance using NGINX GeoIP2 + CockroachDB for cross-region data replication.

**Stack:** NGINX + GeoIP2 module, MaxMind GeoLite2 DB, CockroachDB cluster, 2+ regional servers.

### Setup

**1. Install GeoIP2 on the entry-point server:**
```bash
apt install libnginx-mod-http-geoip2 geoipupdate
# Add your MaxMind license to /etc/GeoIP.conf, then run: geoipupdate
```

**2. Add to `nginx.conf` inside `http {}`:**
```nginx
geoip2 /var/lib/GeoIP/GeoLite2-Country.mmdb {
    $geoip2_continent_code continent code;
}

map $geoip2_continent_code $backend {
    default  usa_backend;
    EU       europe_backend;
    AS       asia_backend;
    NA       usa_backend;
    SA       usa_backend;
    OC       asia_backend;
    AF       europe_backend;
}

upstream europe_backend { server 127.0.0.1:3000; keepalive 32; }
upstream asia_backend    { server <ASIA_IP>:3000;  keepalive 32; }
upstream usa_backend     { server <USA_IP>:3000;   keepalive 32; }
```
> Use `127.0.0.1` for the local server to avoid hairpin NAT issues on cloud providers.

**3. In your site config, use the dynamic backend:**
```nginx
location / {
    proxy_pass http://$backend;
}
```

**4. If behind Cloudflare**, add to `nginx.conf` so GeoIP sees real visitor IPs:
```nginx
set_real_ip_from 103.21.244.0/22;   # ... add all Cloudflare ranges
set_real_ip_from 173.245.48.0/20;   # Full list: https://cloudflare.com/ips
real_ip_header CF-Connecting-IP;
```

**5. Database** — use CockroachDB for automatic replication:
```toml
[settings]
database = { url = "postgresql://root@localhost:26257/heliactyl?sslmode=disable" }
```
Each instance connects to its local CockroachDB node; replication is handled automatically.

## License

This project is licensed under the Heliactyl Next Public Use License - see the LICENSE file for details.

## Support

For support, please open an issue on the GitHub repository or join our Discord community.

## Security

To report security vulnerabilities, please email toledo@overnode.fr
