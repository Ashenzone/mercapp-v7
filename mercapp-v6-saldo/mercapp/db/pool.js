const { Pool } = require('pg');

// No Railway a variavel DATABASE_URL (ou DATABASE_PUBLIC_URL, usada localmente)
// ja vem pronta. So nao usamos SSL quando o host e' localhost (banco local).
const url = process.env.DATABASE_URL || '';
const isLocal = /localhost|127\.0\.0\.1/.test(url);

const pool = new Pool({
  connectionString: url,
  ssl: url && !isLocal ? { rejectUnauthorized: false } : false,
});

module.exports = { pool };
