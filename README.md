# Heliactyl Next (Toledo) - Server

The all-in-one game hosting control panel backend built for Pterodactyl's daemon (Wings).

## Structure

The workspace directory structure must look like this:
```text
├── frontend/
└── server/
```

## Required: Wings Configuration

Before deploying Heliactyl Next, you must configure the Wings daemon on each node:

1. Edit the Wings configuration file (usually `/etc/pterodactyl/config.yml`).
2. Locate the `allowed-origins` section.
3. Update it to allow your dashboard domain:
   ```yaml
   allowed-origins: ['https://your-dashboard-domain.com']
   ```
   Or allow all origins:
   ```yaml
   allowed-origins: ['*']
   ```

If this configuration is missing, the dashboard will not be able to communicate with the nodes.

## Prerequisites

- Node.js v18+ or Bun v1.1+
- Redis server
- Nginx
- SSL Certificate

## Installation

### 1. Install Redis

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install redis-server
sudo systemctl start redis
sudo systemctl enable redis
```

### 2. Configure and Run

1. Clone the repository and navigate to the server folder:
   ```bash
   git clone https://github.com/re-heliactyl/Toledo
   cd Toledo/server
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Create the configuration file:
   ```bash
   cp example_config.toml config.toml
   ```
   Edit `config.toml` to configure your database, website, and Pterodactyl details.

4. Create a `.env` file in the server directory for Prisma:
   ```env
   DB_PROVIDER="sqlite"
   DATABASE_URL="file:./prisma/heliactyl.db"
   ```

5. Push the database schema:
   ```bash
   pnpm run prisma:push:sqlite
   ```

6. Deploy the frontend:
   Build the frontend client to generate static assets:
   ```bash
   # Build the frontend from the server directory
   pnpm run mono:build
   ```

   > [!TIP]
   > For production deployments, it is recommended to build the frontend locally on your machine, then upload only the generated `dist/` directory to the server's `frontend/` folder. This keeps the production environment clean and avoids resource-heavy builds on the server.

7. Start the application:
   ```bash
   pnpm start
   ```

## Nginx Configuration

Use the following configuration to proxy requests to the dashboard backend (running on port 3000 by default):

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name dashboard.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name dashboard.yourdomain.com;

    client_max_body_size 100M;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_request_buffering off;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

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
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        proxy_buffering off;
    }
}
```
