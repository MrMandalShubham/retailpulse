# Deploying DIP Engine on DigitalOcean

DIP Engine is a storage-free 2-step engine (discover → ingest+clean). Production
is just two moving parts:

- **A managed Postgres database** — the clean store + snapshots + discovery map.
- **One droplet** that runs the **API** (health + `/monitoring`) as a service and
  a **cron** that periodically syncs the catalog.

No object storage, no Redis, no queue. If the droplet dies, nothing is lost —
rebuild it and re-run; the database holds all state.

---

## 1. Managed Postgres

You already have a DO Managed Postgres cluster. For production:

1. **Create a dedicated app user** (don't ship `doadmin`):
   ```sql
   CREATE USER dip_app WITH PASSWORD '...';
   GRANT ALL ON DATABASE defaultdb TO dip_app;
   ```
2. **Rotate `doadmin`** if its password was ever shared (it was, during
   development) — DO console → Database → Users → Reset password.
3. Later, for any dashboard/BI reader, add a **read-only** user:
   ```sql
   CREATE USER dip_read WITH PASSWORD '...';
   GRANT CONNECT ON DATABASE defaultdb TO dip_read;
   GRANT USAGE ON SCHEMA public TO dip_read;
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO dip_read;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dip_read;
   ```
4. Add the droplet to the database's **Trusted Sources** (VPC/private
   networking) so the DB isn't exposed publicly. Then use the **private** host +
   `sslmode=require` in `DATABASE_URL`.

## 2. Droplet

- Ubuntu 22.04 or 24.04, in the **same region/VPC** as the database.
- A non-root sudo user is fine; the steps below use `/opt/dip-engine`.

```bash
# clone the repo into the app dir
sudo mkdir -p /opt/dip-engine && sudo chown "$USER" /opt/dip-engine
git clone <your-repo-url> /opt/dip-engine
cd /opt/dip-engine

# create the production env file and fill in DATABASE_URL
cp deploy/.env.production.example .env
nano .env      # set DATABASE_URL (private host + sslmode=require)

# install Node 22 + pnpm, install deps, build, migrate, seed
sudo APP_DIR=/opt/dip-engine bash deploy/setup.sh
```

`setup.sh` is idempotent — re-run it after every `git pull` to rebuild and apply
new migrations.

## 3. Run the API as a service

```bash
sudo cp deploy/dip-engine-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dip-engine-api
systemctl status dip-engine-api
curl -s localhost:3000/health        # {"status":"ok",...}
curl -s localhost:3000/health/ready  # database readiness
```

The service binds to `127.0.0.1:3000` (see `.env`). To reach `/monitoring` from
outside, put it behind a reverse proxy (Caddy/nginx) with TLS and auth, or use an
SSH tunnel — do **not** open port 3000 to the internet directly.

## 4. Schedule the catalog sync

```bash
mkdir -p /opt/dip-engine/logs
crontab deploy/crontab.example
crontab -l
tail -f /opt/dip-engine/logs/sync.log
```

The default cron runs every 12h: `discover:run` (refresh the map) then
`ingest:api oliveyoung-global 500` (drain a batch of pending products into the
clean store + snapshots). Tune `INGEST_BATCH` in `crontab.example`. `flock`
prevents overlapping runs.

### Full daily snapshot of the whole catalog

`ingest:api` only processes `pending` rows, so the cron above keeps **new**
products flowing in but does not re-fetch products already marked `ingested`. To
take a fresh price/rating snapshot of the **entire** catalog on a cadence,
re-queue ingested rows before a drain:

```bash
psql "$DATABASE_URL" -c \
  "update discovered_product_pages set batch_status='pending' where batch_status='ingested';"
```

Snapshots are idempotent per `(product_id, captured_at)`, so a same-day re-fetch
just refreshes that day's row. The full catalog is ~16k products at ~0.5s each
(~2–3h of fetching), so spread it across runs or raise `INGEST_BATCH`. The exact
cadence was intentionally left open — wire it in when decided.

## 5. Updating

```bash
cd /opt/dip-engine && git pull
sudo APP_DIR=/opt/dip-engine bash deploy/setup.sh   # rebuild + migrate
sudo systemctl restart dip-engine-api
```

## Operational notes

- **Logs:** API → `journalctl -u dip-engine-api -f`; sync → `logs/sync.log`.
- **Secrets:** only `.env` holds them; it is gitignored. Never commit it.
- **Backups:** DO Managed Postgres has automated backups + point-in-time
  restore; no app-side backup needed.
- **Approved source:** Olive Young Global only. Do not add live sources without
  explicit approval.
