require('dotenv').config();
const express      = require('express');
const session      = require('express-session');
const MySQLStore   = require('express-mysql-session')(session);
const mysql        = require('mysql2/promise');
const bcrypt       = require('bcryptjs');
const path         = require('path');
const helmet       = require('helmet');
const compression  = require('compression');
const rateLimit    = require('express-rate-limit');

// ── Production guard ──────────────────────────────────────────────────────────
const isProd = process.env.NODE_ENV === 'production';
if (isProd && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'change-this-to-a-random-secret')) {
    console.error('FATAL: SESSION_SECRET must be set to a strong random value in production.');
    process.exit(1);
}

const app = express();

// ── Security & performance middleware ─────────────────────────────────────────
// Trust the first proxy hop (Nginx) so req.ip and secure cookies work correctly
if (isProd) app.set('trust proxy', 1);

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc:  ["'self'"],
            scriptSrc:   ["'self'", "'unsafe-inline'"],
            styleSrc:    ["'self'", "'unsafe-inline'"],
            imgSrc:      ["'self'", "data:", "https://web.quarknet.org"],
            connectSrc:  ["'self'"],
            fontSrc:     ["'self'", "data:"],
            objectSrc:   ["'none'"],
            upgradeInsecureRequests: isProd ? [] : null
        }
    }
}));

app.use(compression());

// Rate-limit the login endpoint: 10 attempts per 15 minutes per IP
app.use('/api/auth/login', rateLimit({
    windowMs:         15 * 60 * 1000,
    max:              10,
    standardHeaders:  true,
    legacyHeaders:    false,
    message:          { error: 'Too many login attempts. Try again in 15 minutes.' }
}));

app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));

// Cache static assets for 1 day in production
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: isProd ? '1d' : 0
}));

// ── Database pool ─────────────────────────────────────────────────────────────
// Sizing: each PM2 worker gets its own pool.
// Keep (instances × connectionLimit) well below MariaDB's max_connections (default 151).
// With instances=4 and connectionLimit=15: 4×15 = 60 app connections.
// The session store adds its own small pool (connectionLimit=3): 4×3 = 12 more.
// Total: ~72 connections — safe headroom for a 151-connection MariaDB server.
const DB_CONFIG = {
    host:     process.env.DB_HOST     || 'localhost',
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'cima',
    charset:  'utf8mb4'
};

const pool = mysql.createPool({
    ...DB_CONFIG,
    waitForConnections: true,
    connectionLimit:    15,   // per worker process
    queueLimit:         50,   // reject (don't hang) if >50 requests are waiting
    enableKeepAlive:    true,
    keepAliveInitialDelay: 10000,
    dateStrings: ['DATE']  // return DATE columns as 'YYYY-MM-DD' strings; leave TIMESTAMP as JS Date
});

// Log pool-level errors so they appear in PM2 logs instead of crashing silently
pool.pool.on('error', (err) => {
    console.error(`[${new Date().toISOString()}] DB pool error:`, err.message);
});

// ── Shared session store ───────────────────────────────────────────────────────
// Sessions must live in MariaDB (not process memory) so all PM2 cluster workers
// share the same session state.  express-mysql-session creates the `sessions`
// table automatically on first start.
const sessionStore = new MySQLStore({
    ...DB_CONFIG,             // includes charset: 'utf8mb4'
    clearExpired:            true,
    checkExpirationInterval: 15 * 60 * 1000,    // prune expired rows every 15 min
    expiration:               8 * 60 * 60 * 1000, // match cookie maxAge
    createDatabaseTable:     true,
    connectionLimit:         3    // small dedicated pool; sessions are infrequent
    // charset deliberately omitted here — DB_CONFIG already sets 'utf8mb4'.
    // 'utf8mb4_unicode_ci' is a collation name, not a charset, and would cause
    // a "Unknown character set" error on MariaDB when establishing connections.
});

app.use(session({
    secret:            process.env.SESSION_SECRET || 'cima-dev-secret-not-for-prod',
    resave:            false,
    saveUninitialized: false,
    store:             sessionStore,   // ← shared across all cluster workers
    cookie: {
        httpOnly: true,
        secure:   isProd,              // HTTPS-only in production
        sameSite: 'lax',
        maxAge:   8 * 60 * 60 * 1000  // 8 hours
    }
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
const requireAdmin = (req, res, next) => {
    if (req.session && req.session.isAdmin) return next();
    res.status(401).json({ error: 'Unauthorized' });
};

// Hide internal details from API error responses in production
function apiError(res, status, message, internalErr) {
    if (internalErr) console.error(internalErr);
    res.status(status).json({ error: message });
}

// ── Auth ──────────────────────────────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });
    try {
        const [rows] = await pool.query(
            'SELECT password_hash FROM admin_users WHERE username = ?', ['admin']
        );
        if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
            return res.status(401).json({ error: 'Invalid password' });
        }
        req.session.isAdmin = true;
        res.json({ success: true });
    } catch (err) {
        apiError(res, 500, 'Server error', err);
    }
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/auth/status', (req, res) => {
    res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// Change admin password  (must be logged in)
app.post('/api/auth/change-password', requireAdmin, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'currentPassword and newPassword required' });
    }
    if (newPassword.length < 10) {
        return res.status(400).json({ error: 'New password must be at least 10 characters' });
    }
    try {
        const [rows] = await pool.query(
            'SELECT password_hash FROM admin_users WHERE username = ?', ['admin']
        );
        if (!rows.length || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        const hash = await bcrypt.hash(newPassword, 12);
        await pool.query(
            'UPDATE admin_users SET password_hash = ? WHERE username = ?', [hash, 'admin']
        );
        res.json({ success: true });
    } catch (err) {
        apiError(res, 500, 'Server error', err);
    }
});

// ── Masterclasses ─────────────────────────────────────────────────────────────

app.get('/api/masterclasses', async (req, res) => {
    try {
        // Admin can pass ?all=1 to include archived masterclasses
        const showAll = req.query.all === '1' && req.session && req.session.isAdmin;
        const [rows] = await pool.query(
            showAll
                ? 'SELECT * FROM masterclasses ORDER BY archived ASC, event_date DESC, name'
                : 'SELECT * FROM masterclasses WHERE archived = 0 ORDER BY event_date DESC, name'
        );
        res.json(rows);
    } catch (err) {
        apiError(res, 500, 'Server error', err);
    }
});

app.get('/api/masterclasses/:id', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM masterclasses WHERE id = ?', [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Not found' });
        res.json(rows[0]);
    } catch (err) {
        apiError(res, 500, 'Server error', err);
    }
});

app.post('/api/masterclasses', requireAdmin, async (req, res) => {
    const { name, event_date, num_datasets } = req.body;
    if (!name || !event_date || !num_datasets) {
        return res.status(400).json({ error: 'Name, date, and dataset count required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(event_date)) {
        return res.status(400).json({ error: 'Invalid date format (expected YYYY-MM-DD)' });
    }
    const n = parseInt(num_datasets);
    if (isNaN(n) || n < 1 || n > 100) {
        return res.status(400).json({ error: 'Dataset count must be 1–100' });
    }
    try {
        const [result] = await pool.query(
            'INSERT INTO masterclasses (name, event_date, num_datasets) VALUES (?, ?, ?)',
            [name.trim(), event_date, n]
        );
        res.json({ id: result.insertId, name: name.trim(), event_date, num_datasets: n });
    } catch (err) {
        apiError(res, 500, 'Server error', err);
    }
});

app.delete('/api/masterclasses/:id', requireAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM masterclasses WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        apiError(res, 500, 'Server error', err);
    }
});

app.patch('/api/masterclasses/:id', requireAdmin, async (req, res) => {
    const { name, event_date } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
    if (!event_date || !/^\d{4}-\d{2}-\d{2}$/.test(event_date)) {
        return res.status(400).json({ error: 'Valid date is required (YYYY-MM-DD)' });
    }
    try {
        const [result] = await pool.query(
            'UPDATE masterclasses SET name = ?, event_date = ? WHERE id = ?',
            [name.trim(), event_date, req.params.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ success: true });
    } catch (err) {
        apiError(res, 500, 'Server error', err);
    }
});

app.post('/api/masterclasses/:id/archive', requireAdmin, async (req, res) => {
    try {
        const [result] = await pool.query(
            'UPDATE masterclasses SET archived = 1 WHERE id = ?', [req.params.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ success: true });
    } catch (err) {
        apiError(res, 500, 'Server error', err);
    }
});

app.post('/api/masterclasses/:id/unarchive', requireAdmin, async (req, res) => {
    try {
        const [result] = await pool.query(
            'UPDATE masterclasses SET archived = 0 WHERE id = ?', [req.params.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ success: true });
    } catch (err) {
        apiError(res, 500, 'Server error', err);
    }
});

// ── Event Data ────────────────────────────────────────────────────────────────

app.get('/api/events/:masterclassId/:datasetNum', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT event_num, final_state, primary_state, mass_gev
             FROM event_data
             WHERE masterclass_id = ? AND dataset_num = ?
             ORDER BY event_num`,
            [req.params.masterclassId, req.params.datasetNum]
        );
        res.json(rows);
    } catch (err) {
        apiError(res, 500, 'Server error', err);
    }
});

app.post('/api/events', async (req, res) => {
    const { masterclass_id, dataset_num, event_num, final_state, primary_state, mass_gev } = req.body;
    if (!masterclass_id || !dataset_num || !event_num) {
        return res.status(400).json({ error: 'masterclass_id, dataset_num, event_num required' });
    }

    const massVal = (primary_state === 'NP(Z,H)' && mass_gev !== null && mass_gev !== '' && mass_gev !== undefined)
        ? parseFloat(mass_gev) : null;

    if (massVal !== null && isNaN(massVal)) {
        return res.status(400).json({ error: 'Invalid mass value' });
    }

    try {
        await pool.query(
            `INSERT INTO event_data
                (masterclass_id, dataset_num, event_num, final_state, primary_state, mass_gev)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                final_state   = VALUES(final_state),
                primary_state = VALUES(primary_state),
                mass_gev      = VALUES(mass_gev)`,
            [masterclass_id, dataset_num, event_num,
             final_state || null, primary_state || null, massVal]
        );
        res.json({ success: true });
    } catch (err) {
        apiError(res, 500, 'Server error', err);
    }
});

// ── Summary ───────────────────────────────────────────────────────────────────

// Aggregate: combine data from multiple masterclasses
// Must be defined BEFORE /:masterclassId so Express doesn't swallow it
app.get('/api/summary/aggregate', async (req, res) => {
    const ids = (req.query.ids || '').split(',')
        .map(Number).filter(n => Number.isInteger(n) && n > 0);
    if (!ids.length) return res.status(400).json({ error: 'No valid IDs provided' });

    try {
        const [mcs] = await pool.query(
            'SELECT * FROM masterclasses WHERE id IN (?) ORDER BY created_at',
            [ids]
        );
        if (!mcs.length) return res.status(404).json({ error: 'Not found' });

        const mcIds = mcs.map(m => m.id);
        const [events] = await pool.query(
            `SELECT masterclass_id, final_state, primary_state, mass_gev
             FROM event_data WHERE masterclass_id IN (?)
             ORDER BY masterclass_id`,
            [mcIds]
        );

        const fsTotals = { 'e-v': 0, 'μ-ν': 0, 'e-e': 0, 'μ-μ': 0, '4e': 0, '4μ': 0, '2e-2μ': 0 };
        const psTotals = { 'W+': 0, 'W-': 0, 'NP(Z,H)': 0, 'Zoo': 0 };
        const masses   = [];
        const mcTotals = {};

        for (const mc of mcs) {
            mcTotals[mc.id] = {
                name: mc.name,
                fs: { 'e-v': 0, 'μ-ν': 0, 'e-e': 0, 'μ-μ': 0, '4e': 0, '4μ': 0, '2e-2μ': 0 },
                ps: { 'W+': 0, 'W-': 0, 'NP(Z,H)': 0, 'Zoo': 0 }
            };
        }

        for (const ev of events) {
            if (ev.final_state && Object.prototype.hasOwnProperty.call(fsTotals, ev.final_state)) {
                fsTotals[ev.final_state]++;
                if (mcTotals[ev.masterclass_id]) mcTotals[ev.masterclass_id].fs[ev.final_state]++;
            }
            if (ev.primary_state && Object.prototype.hasOwnProperty.call(psTotals, ev.primary_state)) {
                psTotals[ev.primary_state]++;
                if (mcTotals[ev.masterclass_id]) mcTotals[ev.masterclass_id].ps[ev.primary_state]++;
            }
            if (ev.mass_gev !== null && ev.mass_gev !== undefined) {
                masses.push({ mass: parseFloat(ev.mass_gev), finalState: ev.final_state });
            }
        }

        res.json({ masterclasses: mcs, fsTotals, psTotals, masses, mcTotals });
    } catch (err) {
        apiError(res, 500, 'Server error', err);
    }
});

app.get('/api/summary/:masterclassId', async (req, res) => {
    try {
        const [mc] = await pool.query(
            'SELECT * FROM masterclasses WHERE id = ?', [req.params.masterclassId]
        );
        if (!mc.length) return res.status(404).json({ error: 'Not found' });

        const [events] = await pool.query(
            `SELECT dataset_num, event_num, final_state, primary_state, mass_gev
             FROM event_data WHERE masterclass_id = ?
             ORDER BY dataset_num, event_num`,
            [req.params.masterclassId]
        );

        const fsTotals = { 'e-v': 0, 'μ-ν': 0, 'e-e': 0, 'μ-μ': 0, '4e': 0, '4μ': 0, '2e-2μ': 0 };
        const psTotals = { 'W+': 0, 'W-': 0, 'NP(Z,H)': 0, 'Zoo': 0 };
        const masses   = [];
        const dsTotals = {};

        for (const ev of events) {
            const ds = ev.dataset_num;
            if (!dsTotals[ds]) {
                dsTotals[ds] = {
                    fs: { 'e-v': 0, 'μ-ν': 0, 'e-e': 0, 'μ-μ': 0, '4e': 0, '4μ': 0, '2e-2μ': 0 },
                    ps: { 'W+': 0, 'W-': 0, 'NP(Z,H)': 0, 'Zoo': 0 }
                };
            }
            if (ev.final_state   && Object.prototype.hasOwnProperty.call(fsTotals, ev.final_state))   { fsTotals[ev.final_state]++;   dsTotals[ds].fs[ev.final_state]++; }
            if (ev.primary_state && Object.prototype.hasOwnProperty.call(psTotals, ev.primary_state)) { psTotals[ev.primary_state]++; dsTotals[ds].ps[ev.primary_state]++; }
            if (ev.mass_gev !== null && ev.mass_gev !== undefined) masses.push({ mass: parseFloat(ev.mass_gev), finalState: ev.final_state });
        }

        res.json({ masterclass: mc[0], fsTotals, psTotals, masses, dsTotals });
    } catch (err) {
        apiError(res, 500, 'Server error', err);
    }
});

// ── 404 / global error handler ────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: isProd ? 'Internal server error' : err.message });
});

// ─────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
// In production Nginx proxies to 127.0.0.1, so we bind to IPv4 loopback only.
// In development we also accept ::1 (IPv6 loopback) because macOS resolves
// 'localhost' to ::1 first; binding to '' (all interfaces) covers both.
const BIND_HOST = isProd ? '127.0.0.1' : '';
app.listen(PORT, BIND_HOST, () => {
    console.log(`[${new Date().toISOString()}] CIMA running on ${BIND_HOST || '0.0.0.0/::'}:${PORT} (${isProd ? 'production' : 'development'})`);
});
