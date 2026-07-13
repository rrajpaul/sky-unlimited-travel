const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function initDb() {
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
    CREATE TABLE IF NOT EXISTS giveaway_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      start_date TIMESTAMPTZ NOT NULL,
      end_date TIMESTAMPTZ NOT NULL,
      prize_value_usd NUMERIC(10,2) NOT NULL DEFAULT 200,
      prize_value_cad NUMERIC(10,2) NOT NULL DEFAULT 270,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT single_row CHECK (id = 1)
    )
  `);

  // Seed a default row if none exists yet, so the site has *something* to show
  // on first deploy rather than erroring out. Adjust these defaults as needed —
  // you can always change them from the admin page afterward.
  await pool.query(`
    INSERT INTO giveaway_settings (id, start_date, end_date, prize_value_usd, prize_value_cad)
    VALUES (1, '2026-08-10T00:00:00-04:00', '2026-08-31T23:59:59-04:00', 200, 270)
    ON CONFLICT (id) DO NOTHING
  `);
  console.log('Database ready');
}

module.exports = { pool, initDb };