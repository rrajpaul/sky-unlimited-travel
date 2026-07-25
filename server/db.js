const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inquiries (
      id SERIAL PRIMARY KEY,
      type VARCHAR(20) NOT NULL DEFAULT 'contact',
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      phone VARCHAR(50),
      details TEXT,
      country VARCHAR(255),
      city VARCHAR(255),
      payment_link_sent BOOLEAN DEFAULT false,
      payment_link_sent_at TIMESTAMPTZ,
      payment_status VARCHAR(20) DEFAULT 'unpaid',
      payment_paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      from_date DATE,
      to_date DATE
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS giveaway_entries (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      destination VARCHAR(20) NOT NULL DEFAULT 'Either',
      is_winner BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    ALTER TABLE giveaway_entries
      ADD COLUMN IF NOT EXISTS winner_email_sent BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS winner_email_sent_at TIMESTAMPTZ
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS giveaway_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      start_date TIMESTAMPTZ NOT NULL,
      end_date TIMESTAMPTZ NOT NULL,
      prize_value_usd NUMERIC(10,2) NOT NULL DEFAULT 200,
      prize_value_cad NUMERIC(10,2) NOT NULL DEFAULT 270,
      destinations JSONB NOT NULL DEFAULT '["Jamaica"]',
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT single_row CHECK (id = 1)
    )
  `);

  await pool.query(`
    ALTER TABLE giveaway_settings
      ADD COLUMN IF NOT EXISTS prize_value_usd NUMERIC(10,2) NOT NULL DEFAULT 200,
      ADD COLUMN IF NOT EXISTS prize_value_cad NUMERIC(10,2) NOT NULL DEFAULT 270,
      ADD COLUMN IF NOT EXISTS destinations JSONB NOT NULL DEFAULT '["Jamaica"]'
  `);

  console.log('Database ready');
}

module.exports = { pool, initDb };