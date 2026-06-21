# CIMA — CMS Instrument for Masterclass Analysis

A web application for high-school physics masterclasses run through the
[QuarkNet](https://quarknet.org) programme.  Students examine simulated CMS
collision events, classify each one by its final state and primary particle,
and record reconstructed masses.  Teachers use the admin interface to create
and manage masterclass sessions; the summary page aggregates the results into
tables and mass-distribution histograms.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Pages and User Flows](#pages-and-user-flows)
3. [Node.js Server](#nodejs-server)
4. [API Endpoints](#api-endpoints)
5. [MariaDB Database](#mariadb-database)
6. [PM2 Cluster Configuration](#pm2-cluster-configuration)
7. [Nginx Reverse Proxy](#nginx-reverse-proxy)
8. [Capacity and Scalability](#capacity-and-scalability)
9. [Installation](#installation)
10. [Environment Variables](#environment-variables)
11. [Development](#development)

---

## Architecture Overview

```
Browser
  │
  ▼
Nginx (port 443, TLS)
  ├── Static files served directly from public/
  └── Dynamic requests proxied to Node.js cluster
          │
          ▼
      PM2 cluster (4 workers, all on port 3000)
          │
          ▼
      Express.js  ──►  MariaDB (cima database)
```

- **Nginx** terminates TLS, serves static assets with long cache headers, and
  forwards API and page requests to the Node cluster via a persistent keepalive
  upstream connection.
- **Node.js / Express** handles all business logic and database access.  Four
  worker processes run in PM2 cluster mode and share a single port.
- **MariaDB** stores masterclass definitions, per-event classifications, and
  admin credentials.  Sessions are also persisted in MariaDB so all workers
  share authentication state without needing sticky sessions in Nginx.

---

## Pages and User Flows

### `index.html` — Home / Masterclass List
Fetches `GET /api/masterclasses` and renders a table of active (non-archived)
masterclasses.  Each row has:
- **Enter Data →** — opens the data-entry page for that masterclass.
- **Summary →** — opens the single-masterclass summary page.
- A **checkbox** for selecting multiple masterclasses.

When two or more checkboxes are ticked a blue action bar appears with a
**View Combined Summary →** button that navigates to
`summary.html?ids=1,2,3`.

### `masterclass.html` — Event Data Entry
Loaded with `?id=<masterclassId>` in the URL.

Renders a 100-row table.  For each collision event the student selects:

| Column group | Options |
|---|---|
| **Final State** | e-ν, μ-ν, e-e, μ-μ, 4e, 4μ, 2e-2μ |
| **Primary State** | W+, W−, NP(Z,H), Zoo |
| **Mass [GeV]** | Numeric input — enabled only when Primary State is NP(Z,H) |

A **Dataset** drop-down at the top lets the student switch between the datasets
assigned to that masterclass (1 … `num_datasets`).  Changing the selection
flushes any pending saves and reloads that dataset from the server.

Saves are automatic: every radio-button change fires immediately; mass inputs
are debounced 800 ms and also saved on blur/Enter.  Saves are serialised
through a promise queue so rapid changes never arrive out of order.  A
save-status chip in the toolbar shows **Saving…**, **Saved ✓**, or
**Save error ✗**.

A live **Totals** row at the bottom of the table counts current selections.

### `summary.html` — Results Summary

Operates in two modes selected by the URL parameter:

**Single mode** (`?id=<masterclassId>`)
- Fetches `GET /api/summary/<id>`.
- Displays Final State Totals, Primary State Totals, Particle Statistics
  (W⁺/W⁻ ratio, lepton universality), a Per-Dataset Breakdown table, and two
  mass-distribution histograms (two-lepton: e-e / μ-μ; four-lepton: 4e / 4μ /
  2e-2μ).

**Aggregate mode** (`?ids=1,2,3`)
- Fetches `GET /api/summary/aggregate?ids=1,2,3`.
- Displays the same cards with combined data from all selected masterclasses.
- The breakdown table becomes **Per-Masterclass Breakdown** showing each
  masterclass's individual contribution plus a grand-total row.

Both histograms have adjustable Min, Max, and Bin Width controls.  The axis
range is set automatically on first load using the actual data spread.

### `admin.html` — Administration
Protected by a session-based login.  Provides:

- **Create Masterclass** — name and number of datasets (1–100).
- **Rename Masterclass** — modal dialog pre-filled with the current name.
- **Archive / Unarchive** — archived masterclasses are hidden from the home
  page but their data is preserved.  They can be reinstated at any time.
- **Delete Masterclass** — permanently removes the masterclass and all its
  event data (cascaded in the database).
- **Change Admin Password** — requires the current password; enforces a
  minimum of 10 characters.

---

## Node.js Server

`server.js` is a single Express application.  In production it is run as four
worker processes by PM2 (see [PM2 Cluster Configuration](#pm2-cluster-configuration)).

### Middleware stack (in order)

| Middleware | Purpose |
|---|---|
| `helmet` | Sets HTTP security headers: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy |
| `compression` | Gzip response bodies |
| `express-rate-limit` | Login endpoint: max 10 attempts per 15 minutes per IP |
| `express.json` / `express.urlencoded` | Parse request bodies (64 KB limit) |
| `express.static` | Serve `public/` — 1-day cache in production, no cache in development |
| `express-session` | Cookie-based sessions backed by MariaDB (shared across all workers) |

### Session handling
Sessions use `express-mysql-session` which automatically creates and manages a
`sessions` table in MariaDB.  This means all four PM2 workers share the same
session store, so a request can be handled by any worker without the user
being logged out.

Session cookies are:
- `httpOnly: true` — inaccessible to JavaScript
- `secure: true` in production — HTTPS only
- `sameSite: 'lax'`
- 8-hour lifetime

### Database connection pool
Each worker maintains its own `mysql2/promise` connection pool:
- `connectionLimit: 15` per worker → 60 app connections across 4 workers
- `connectionLimit: 3` for the session store → 12 session connections
- Total: ~72 connections, well within MariaDB's default limit of 151

---

## API Endpoints

### Authentication

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | — | Validate password, set session |
| `POST` | `/api/auth/logout` | — | Destroy session |
| `GET` | `/api/auth/status` | — | Returns `{ isAdmin: true/false }` |
| `POST` | `/api/auth/change-password` | Admin | Change the admin password |

### Masterclasses

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/masterclasses` | — | List active (non-archived) masterclasses |
| `GET` | `/api/masterclasses/:id` | — | Get a single masterclass |
| `POST` | `/api/masterclasses` | Admin | Create a masterclass |
| `PATCH` | `/api/masterclasses/:id` | Admin | Rename a masterclass |
| `DELETE` | `/api/masterclasses/:id` | Admin | Delete a masterclass (cascades to event data) |
| `POST` | `/api/masterclasses/:id/archive` | Admin | Archive (hide from home page) |
| `POST` | `/api/masterclasses/:id/unarchive` | Admin | Restore to active |

### Event Data

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/events/:masterclassId/:datasetNum` | — | Fetch all events for one dataset |
| `POST` | `/api/events` | — | Upsert a single event (INSERT … ON DUPLICATE KEY UPDATE) |

### Summary

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/summary/:masterclassId` | — | Aggregated totals + masses for one masterclass |
| `GET` | `/api/summary/aggregate?ids=1,2,3` | — | Combined totals + masses for multiple masterclasses |

The summary endpoints return pre-computed objects:
- `fsTotals` — count per final state
- `psTotals` — count per primary state
- `masses` — array of `{ mass, finalState }` for histogram rendering
- `dsTotals` (single) or `mcTotals` (aggregate) — per-dataset or per-masterclass breakdown

---

## MariaDB Database

Database name: `cima`  
Character set: `utf8mb4` / `utf8mb4_unicode_ci`

### Table: `admin_users`

Stores administrator credentials.  Currently only a single `admin` account is
used.

| Column | Type | Notes |
|---|---|---|
| `id` | INT AUTO_INCREMENT | Primary key |
| `username` | VARCHAR(64) UNIQUE | Always `'admin'` |
| `password_hash` | VARCHAR(255) | bcrypt hash, cost factor 12 |

### Table: `masterclasses`

One row per masterclass session.

| Column | Type | Notes |
|---|---|---|
| `id` | INT AUTO_INCREMENT | Primary key |
| `name` | VARCHAR(255) | Display name |
| `num_datasets` | INT | How many datasets are assigned (1–100) |
| `archived` | TINYINT(1) DEFAULT 0 | 0 = active, 1 = archived (hidden from home page) |
| `created_at` | TIMESTAMP | Set automatically on INSERT |

### Table: `event_data`

One row per (masterclass, dataset, event) triple.  Rows are created or updated
on every save from the data-entry page.

| Column | Type | Notes |
|---|---|---|
| `id` | INT AUTO_INCREMENT | Primary key |
| `masterclass_id` | INT | Foreign key → `masterclasses.id` ON DELETE CASCADE |
| `dataset_num` | INT | Which dataset within the masterclass (1 … `num_datasets`) |
| `event_num` | INT | Which event within the dataset (1–100) |
| `final_state` | VARCHAR(20) NULL | e.g. `'e-e'`, `'μ-μ'`, `'4e'` |
| `primary_state` | VARCHAR(20) NULL | `'W+'`, `'W-'`, `'NP(Z,H)'`, or `'Zoo'` |
| `mass_gev` | DECIMAL(12,4) NULL | Reconstructed mass; only set when primary state is NP(Z,H) |

**Unique constraint:** `(masterclass_id, dataset_num, event_num)` — ensures
each event slot is stored exactly once.  The API uses `INSERT … ON DUPLICATE
KEY UPDATE` so saving the same event twice overwrites rather than duplicates it.

**Cascade delete:** deleting a masterclass automatically removes all its event
data via the foreign key constraint.

### Table: `sessions`

Created and managed automatically by `express-mysql-session`.  Stores
serialised session data so all PM2 workers share authentication state.  Expired
rows are pruned every 15 minutes.

---

## PM2 Cluster Configuration

`ecosystem.config.js` launches four Node.js worker processes sharing port 3000.

```
┌─────────────────────────────────────────────┐
│  PM2                                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ Worker 0 │ │ Worker 1 │ │ Worker 2 │ │ Worker 3 │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
│        all listening on 127.0.0.1:3000                 │
└─────────────────────────────────────────────┘
```

Key settings:

| Setting | Value | Reason |
|---|---|---|
| `instances` | 4 | Parallelise across CPU cores |
| `exec_mode` | `'cluster'` | Workers share the port via Node's `cluster` module |
| `wait_ready` | `true` | Worker signals PM2 with `process.send('ready')` once the HTTP server is listening — prevents traffic before the DB pool is ready |
| `listen_timeout` | 10 000 ms | Grace period before PM2 considers a worker failed |
| `max_memory_restart` | 500 MB | Auto-restart if a worker leaks memory |
| `restart_delay` | 10 000 ms | Back-off between crash restarts |

Logs are written to `logs/err.log` and `logs/out.log` with timestamps, and
merged across all workers into a single file.

---

## Nginx Reverse Proxy

`nginx/cima.conf` defines two server blocks.

**Port 80** — redirects all traffic to HTTPS, except Let's Encrypt ACME
challenge requests (used for certificate renewal).

**Port 443** — handles all production traffic:

- TLS certificates managed by Certbot / Let's Encrypt.
- Security headers: HSTS (2-year, preload), X-Frame-Options: DENY,
  X-Content-Type-Options: nosniff, Referrer-Policy.
- Static assets (`*.css`, `*.js`, `*.png`, etc.) served directly from
  `public/` with a 7-day cache and `immutable` hint.
- All other requests fall back to the Node cluster via a named upstream
  (`@node`) with HTTP/1.1 keepalive (32 idle connections).
- Extra rate limiting on `/api/auth/login`: 5 requests per minute per IP,
  burst of 3 (in addition to Express's own rate limiter).
- Gzip compression enabled for text, CSS, JSON, and JavaScript.
- `.env` and `.git` paths are blocked with `deny all`.

---

## Capacity and Scalability

The current architecture is well suited for a typical masterclass event with
**up to ~150 simultaneous users**.

### What handles the load

| Layer | How it scales |
|---|---|
| **Nginx** | Serves all static assets (HTML, CSS, JS, Chart.js) directly from disk with a 7-day cache header — these requests never reach Node.js. After the first page load, browsers serve assets from their local cache. |
| **PM2 (4 workers)** | Node.js is non-blocking; each worker can interleave hundreds of concurrent async I/O operations. Four workers cover all available CPU cores and share incoming connections via the OS kernel. |
| **Connection pool (60 conns)** | Each of the 60 pooled DB connections turns over roughly 200 short queries per second (typical query latency < 5 ms). This comfortably serves bursts of simultaneous data-entry saves from many students. |
| **MariaDB sessions** | Because sessions are stored in MariaDB (not per-process memory), any worker can handle any request — there is no sticky-session requirement on Nginx. |

### Known limits

- **`queueLimit: 50`** — if more than 50 requests are simultaneously waiting
  for a DB connection (e.g., all students click Save in the exact same
  millisecond), excess requests are rejected rather than queued indefinitely.
  In practice, student data-entry actions are naturally staggered enough that
  this threshold is unlikely to be reached.

- **Server RAM** — with `max_memory_restart: 500 MB` per worker, the four
  workers can collectively consume up to ~2 GB before PM2 triggers a restart.
  A server with at least 4 GB RAM is recommended to leave headroom for the OS,
  MariaDB, and Nginx.

- **MariaDB `max_connections`** — the default is 151. The app uses ~72
  connections (60 app + 12 session store). If you run additional services on
  the same database server, verify the total stays below the limit:
  `SHOW VARIABLES LIKE 'max_connections';`

### Recommended minimum server specs

| Resource | Minimum | Comfortable |
|---|---|---|
| CPU cores | 2 | 4 |
| RAM | 2 GB | 4 GB |
| Disk | 10 GB | 20 GB |

For a single-school masterclass (≤ 150 students), a modest 2-core / 4 GB
virtual machine is sufficient.  Larger events or multiple concurrent
masterclasses sharing the same server benefit from 4 cores and 8 GB.

---

## Installation

Tested on **Debian 12 (Bookworm)** and **Debian 13 (Trixie)**.  All commands
below assume a non-root user with `sudo` access.

### 1. Install system dependencies

```bash
sudo apt update && sudo apt upgrade -y

# Node.js 22 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# MariaDB
sudo apt install -y mariadb-server
sudo systemctl enable --now mariadb

# Nginx
sudo apt install -y nginx
sudo systemctl enable --now nginx

# Certbot (Let's Encrypt)
sudo apt install -y certbot python3-certbot-nginx

# PM2 process manager (global)
sudo npm install -g pm2
```

### 2. Create a dedicated application user

Running the app as its own unprivileged user keeps it isolated from the rest of
the system.

```bash
sudo adduser --disabled-password --gecos "" cima
sudo -u cima -i          # switch to the cima user for the remaining steps
```

### 3. Clone the repository

```bash
git clone https://github.com/joelklammer/CIMA.git ~/cima
cd ~/cima
npm install
```

### 4. Create the `.env` file

```bash
cp .env.example .env
nano .env
```

Set at minimum:

```
DB_USER=cima_app
DB_PASSWORD=<strong password matching step 5>
SESSION_SECRET=<long random string, e.g. output of: openssl rand -hex 64>
NODE_ENV=production
```

### 5. Set up MariaDB

On Debian, MariaDB's root account uses unix socket authentication by default,
so connect without a password using `sudo mariadb`.

```bash
# Create the application database user
# Edit db/create-mariadb-user.sql first: replace 'StrongPasswordHere'
# with the same password you put in .env
exit                            # back to your sudo-capable user
sudo mariadb < /home/cima/cima/db/create-mariadb-user.sql
sudo -u cima -i                 # switch back to the cima user
cd ~/cima
```

Run the setup script to create the database schema and default admin account:

```bash
npm run setup
```

Output will confirm the schema was applied and show the default credentials:
- **Username:** `admin`
- **Password:** `admin123`

> **Important:** Log in to `/admin.html` immediately after deployment and
> change the password using the Change Admin Password form.

### 6. Configure Nginx

Back as your sudo-capable user:

```bash
exit    # leave the cima user shell
```

Edit `nginx/cima.conf` before copying it — replace every occurrence of
`yourdomain.com` with your actual domain, and update the `root` directive to
point to the application's public folder:

```nginx
root /home/cima/cima/public;
```

Then install the config:

```bash
sudo cp /home/cima/cima/nginx/cima.conf /etc/nginx/sites-available/cima
sudo ln -s /etc/nginx/sites-available/cima /etc/nginx/sites-enabled/cima
sudo rm -f /etc/nginx/sites-enabled/default   # remove the default placeholder
sudo nginx -t && sudo systemctl reload nginx
```

### 7. Obtain a TLS certificate

Your domain's DNS A (and AAAA) records must already point to this server
before running Certbot.

```bash
sudo certbot --nginx -d yourdomain.com
```

Certbot edits the Nginx config automatically and sets up a systemd timer for
automatic renewal.  Verify renewal works:

```bash
sudo certbot renew --dry-run
```

### 8. Start the application with PM2

Switch back to the `cima` user:

```bash
sudo -u cima -i
cd ~/cima
pm2 start ecosystem.config.js --env production
pm2 save        # save the process list so PM2 restores it after a reboot
```

Configure PM2 to start automatically on boot via systemd:

```bash
pm2 startup systemd -u cima --hp /home/cima
```

PM2 will print a `sudo env PATH=... pm2 startup ...` command — copy and run
that command as your sudo-capable user to install the systemd unit.

Verify all four workers are running:

```bash
pm2 status
pm2 logs --lines 20
```

### Database migrations

When upgrading from a version that predates the `archived` column:

```bash
sudo mariadb cima < /home/cima/cima/db/migrate-add-archived.sql
pm2 restart cima
```

### Deploying updates

```bash
cd ~/cima
git pull
npm install          # only needed if package.json changed
pm2 restart cima
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in all values before starting the server.

| Variable | Required | Description |
|---|---|---|
| `DB_HOST` | No | MariaDB host (default: `localhost`) |
| `DB_USER` | No | Database user (default: `root`) |
| `DB_PASSWORD` | No | Database password (default: empty) |
| `DB_NAME` | No | Database name (default: `cima`) |
| `SESSION_SECRET` | **Yes** (production) | Random string used to sign session cookies — generate with `openssl rand -hex 64` |
| `PORT` | No | HTTP port the Node server listens on (default: `3000`) |
| `NODE_ENV` | No | Set to `production` to enable HTTPS-only cookies and hide internal error details |

---

## Development

These instructions are for running a local copy on a development machine.

```bash
# Ensure MariaDB is running
sudo systemctl start mariadb

# Install dependencies
npm install

# Run the setup script if the database doesn't exist yet
npm run setup

# Start the server with auto-restart on file changes
npm run dev
```

The dev server binds to all interfaces (`0.0.0.0` / `::`) so it is reachable
at both `http://localhost:3000` and `http://127.0.0.1:3000`.

`NODE_ENV` is not set in development, so cookies do not require HTTPS and
internal error messages are shown in API responses.
