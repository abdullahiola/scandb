# Deploying ScanDB to a VPS

This guide runs ScanDB in production with `docker-compose.prod.yml`. That file
starts four containers:

| Container | Role | Reachable from the internet |
|-----------|------|-----------------------------|
| `scandb-proxy` (Caddy) | HTTPS, reverse proxy, certificates | Yes, on ports 80 and 443 |
| `scandb-web` (Next.js) | UI and API proxy | No |
| `scandb-api` (FastAPI) | OCR, classification, SQLite | No |
| `scandb-llm` (Ollama) | Local LLM for AI cleaning | No |

```
Internet ──► Caddy :443 ──► frontend:3000 ──► backend:8000
                                  └─────────► ollama:11434
```

---

## 1. Requirements

**Server**

| Setup | RAM | Disk |
|-------|-----|------|
| Gemini for AI (no Ollama model in use) | 4 GB | 15 GB |
| Ollama with `qwen2.5:3b-instruct` (default) | 8 GB | 20 GB |
| Ollama with `qwen2.5:7b-instruct` | 12–16 GB | 25 GB |

- Ubuntu 22.04 or 24.04, or Debian 12. Other Linux distributions work if they run Docker.
- 2 or more vCPUs. OCR is CPU-bound, so more cores make scans faster.
- x86_64 or ARM64.

**Other**

- A domain or subdomain, for example `scandb.example.com`.
- SSH access to the server with a user that can run `sudo`.

---

## 2. Point the domain at the server

At your DNS provider, create these records for the hostname:

| Type | Name | Value |
|------|------|-------|
| `A` | `scandb` | your VPS IPv4 address |
| `AAAA` | `scandb` | your VPS IPv6 address (optional) |

Check the record before you continue. The command must print the VPS address.

```bash
dig +short scandb.example.com
```

Caddy can only get a certificate after the record resolves.

---

## 3. Prepare the server

### Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# Log out and back in so the group change applies, then:
docker compose version
```

### Open the firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp   # HTTP/3
sudo ufw enable
```

If your provider also has a cloud firewall or security group, open the same
ports there.

### Add swap (recommended on 4–8 GB servers)

OCR and the LLM can briefly use more memory than expected. Swap stops the
kernel from killing a container when that happens.

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 4. Get the code and configure it

```bash
git clone <your-repo-url> scandb
cd scandb
cp .env.example .env
nano .env
```

**Required**

```env
DOMAIN=scandb.example.com
```

**AI provider: choose one**

To use the local Ollama model (the default), pick a model that fits your RAM:

```env
OLLAMA_MODEL=qwen2.5:3b-instruct
OLLAMA_MEMORY_LIMIT=6g
```

To use Gemini instead, which needs much less RAM:

```env
GEMINI_API_KEY=your-key            # free at https://aistudio.google.com/apikey
LLM_PROVIDER=gemini
OLLAMA_MEMORY_LIMIT=1g
```

The Ollama container still starts when you use Gemini, because the frontend
waits for it. With a 1 GB limit it uses very little memory. It still downloads
the default model once on the first start.

**Optional settings**

| Variable | Default | Purpose |
|----------|---------|---------|
| `BACKEND_MEMORY_LIMIT` | `3g` | Memory cap for the OCR backend |
| `FRONTEND_MEMORY_LIMIT` | `1g` | Memory cap for Next.js |
| `OLLAMA_MEMORY_LIMIT` | `6g` | Memory cap for Ollama |
| `OLLAMA_IMAGE_TAG` | `latest` | Pin Ollama to a fixed version, for example `0.9.0` |
| `OLLAMA_TIMEOUT_MS` | `120000` | How long to wait for the local model per request |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model when `LLM_PROVIDER=gemini` |

Make sure the memory limits add up to less than the server's RAM.

---

## 5. Start the stack

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

The first start takes a while:

1. The images build. The backend downloads its PaddleOCR models during this step.
2. Ollama downloads its model, about 2 GB for the default.
3. The services start in order: backend, then frontend, then Caddy.
4. Caddy gets a Let's Encrypt certificate.

To follow progress:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f ollama caddy
```

The stack is ready when every service shows `healthy` (Caddy shows `running`).

> **Tip:** to avoid typing `-f docker-compose.prod.yml` each time, run
> `export COMPOSE_FILE=docker-compose.prod.yml` in your shell, or add
> `COMPOSE_FILE=docker-compose.prod.yml` to `.env`. The commands below assume
> you did this.

---

## 6. Verify

| Check | Expected |
|-------|----------|
| `https://scandb.example.com` | The scan page loads with a valid certificate |
| `https://scandb.example.com/repository` | The staff repository loads |
| `curl -I http://scandb.example.com` | A redirect to `https://` |
| `docker compose ps` | All services `healthy` or `running` |

To check the backend from inside the server:

```bash
docker compose exec backend python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health').read().decode())"
```

Scan one test document to confirm that OCR and AI cleaning work.

---

## 7. Updating

```bash
cd scandb
git pull
docker compose up -d --build
docker image prune -f
```

The database, uploads, models and certificates are kept in volumes, so a
rebuild does not remove them.

To rebuild only one service:

```bash
docker compose up -d --build frontend
docker compose up -d --build backend
```

---

## 8. Backups

| Data | Location | Back up? |
|------|----------|----------|
| SQLite database | `./backend/data/scandb.db` on the host | **Yes** |
| Uploaded files | `scandb_frontend-uploads` volume | Yes, if the upload feature is in use |
| TLS certificates | `scandb_caddy-data` volume | Optional. Caddy can get new ones, but Let's Encrypt has rate limits |
| Ollama models | `scandb_ollama-models` volume | No. They download again on start |

Volume names start with the project folder name, so they are `scandb_…` if you
cloned into `scandb/`. Run `docker volume ls` to check.

### Back up the database

This uses SQLite's online backup, so it is safe while the app is running:

```bash
mkdir -p ~/backups
docker compose exec -T backend python -c "
import sqlite3
src = sqlite3.connect('/app/data/scandb.db')
dst = sqlite3.connect('/app/data/backup.db')
src.backup(dst); dst.close(); src.close()"
mv backend/data/backup.db ~/backups/scandb-$(date +%F).db
```

### Daily backups with cron

Save this as `~/scandb-backup.sh` and run `chmod +x ~/scandb-backup.sh`:

```bash
#!/bin/sh
set -e
cd ~/scandb
docker compose -f docker-compose.prod.yml exec -T backend python -c "
import sqlite3
src = sqlite3.connect('/app/data/scandb.db')
dst = sqlite3.connect('/app/data/backup.db')
src.backup(dst); dst.close(); src.close()"
mkdir -p ~/backups
mv backend/data/backup.db ~/backups/scandb-$(date +%F).db
# Keep the last 14 days
find ~/backups -name 'scandb-*.db' -mtime +14 -delete
```

Then add it to cron with `crontab -e`:

```
0 2 * * * $HOME/scandb-backup.sh >> $HOME/backups/backup.log 2>&1
```

Copy the backups off the server regularly, for example with `rsync` or `rclone`
to object storage. A backup that stays on the same VPS is lost along with it.

### Restore

```bash
docker compose stop backend
cp ~/backups/scandb-YYYY-MM-DD.db backend/data/scandb.db
docker compose start backend
```

---

## 9. Operations

```bash
docker compose ps                     # status
docker compose logs -f                # all logs
docker compose logs -f backend        # one service
docker compose restart frontend       # restart one service
docker stats                          # live CPU and memory use
docker compose down                   # stop everything (data is kept)
```

Logs rotate automatically at 10 MB per file, keeping 5 files per container.

To change the Ollama model, edit `OLLAMA_MODEL` in `.env`, then run:

```bash
docker compose up -d
```

The new model downloads on start. To remove an old model:

```bash
docker compose exec ollama ollama rm <old-model>
```

---

## 10. Troubleshooting

**Caddy cannot get a certificate**

Run `docker compose logs caddy`. The usual causes are:

- The DNS record does not point at this server yet. Check with `dig +short $DOMAIN`.
- Port 80 or 443 is blocked by `ufw` or by the provider's firewall.
- Another web server, such as Apache or nginx, already uses port 80 or 443.
  Run `sudo ss -tlnp | grep -E ':80|:443'` to find it.

**The frontend never starts and Ollama stays `starting`**

The model is still downloading, which can take up to 30 minutes on a slow
connection. Run `docker compose logs -f ollama` to watch it.

**A container keeps restarting, or `docker inspect` shows `OOMKilled`**

It ran out of memory. Raise that service's `*_MEMORY_LIMIT`, switch to a smaller
`OLLAMA_MODEL`, use Gemini, or add swap. Run `docker stats` to see actual use.

**502 Bad Gateway**

The frontend is down or restarting. Run `docker compose ps` and
`docker compose logs frontend`.

**Scans time out**

Large PDFs on a small server can be slow. Caddy waits up to 10 minutes per
request; to change that, edit `read_timeout` and `write_timeout` in
`deploy/Caddyfile`, then run `docker compose restart caddy`. For slow AI
cleaning, raise `OLLAMA_TIMEOUT_MS`.

**An upload fails with 413**

The file is over Caddy's 50 MB limit. Raise `max_size` in `deploy/Caddyfile`.

---

## Security notes

- Only ports 80 and 443 are published. The backend has no authentication, so
  do not add a `ports:` entry for it.
- The app itself has no login. Anyone who knows the URL can view and change
  staff records. To restrict access, add `basic_auth` to `deploy/Caddyfile`:

  ```caddyfile
  {$DOMAIN} {
  	basic_auth {
  		admin <hash>
  	}
  	...
  }
  ```

  Generate the hash with:

  ```bash
  docker compose exec caddy caddy hash-password
  ```

  Alternatively, put the server behind a VPN such as Tailscale.
- Keep the server patched with `sudo apt update && sudo apt upgrade`, and
  consider enabling `unattended-upgrades`.
- Use SSH keys and disable password login.
