/**
 * Run once to create the database, tables, and default admin user.
 * Usage: node db/setup.js
 * Default credentials: username=admin  password=admin123
 * Change the password via the admin page after first login.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql  = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const fs     = require('fs');
const path   = require('path');

const DEFAULT_PASSWORD = 'admin123';

async function main() {
    const conn = await mysql.createConnection({
        host:     process.env.DB_HOST     || 'localhost',
        user:     process.env.DB_USER     || 'root',
        password: process.env.DB_PASSWORD || '',
        multipleStatements: true,
        charset: 'utf8mb4'
    });

    console.log('Connected to MariaDB.');

    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await conn.query(schema);
    console.log('Schema applied.');

    const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    await conn.query(
        `INSERT INTO cima.admin_users (username, password_hash)
         VALUES ('admin', ?)
         ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
        [hash]
    );
    console.log('Admin user created/updated.');
    console.log('');
    console.log('  ✓  Setup complete!');
    console.log(`  Username : admin`);
    console.log(`  Password : ${DEFAULT_PASSWORD}  ← change this after logging in`);
    console.log('');

    await conn.end();
}

main().catch(err => {
    // AggregateError (e.g. ECONNREFUSED) has an empty .message; print the full error.
    console.error('Setup failed:', err.message || err);
    if (err.errors) err.errors.forEach(e => console.error(' -', e.message));
    process.exit(1);
});
