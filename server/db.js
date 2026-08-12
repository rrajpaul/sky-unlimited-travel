const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`); // gen_random_uuid()
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "citext"`);   // case-insensitive email

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
    ALTER TABLE inquiries
      ADD COLUMN IF NOT EXISTS destination VARCHAR(255)
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

  // ---------------------------------------------------------------------
  // CRM: contacts + marketing bulletins
  // Deliberately separate from `inquiries` — contacts are a manually
  // managed marketing/relationship list, not auto-populated from inquiries.
  // ---------------------------------------------------------------------
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id                  SERIAL PRIMARY KEY,
      first_name          TEXT NOT NULL DEFAULT '',
      last_name           TEXT NOT NULL DEFAULT '',
      email               CITEXT,
      phone               TEXT,
      company             TEXT,
      city                TEXT,
      country             TEXT,
      tags                TEXT[] NOT NULL DEFAULT '{}',
      source              TEXT NOT NULL DEFAULT 'manual', -- 'manual' | 'import' | 'website'
      notes               TEXT,
      custom_fields       JSONB NOT NULL DEFAULT '{}',

      do_not_email        BOOLEAN NOT NULL DEFAULT FALSE,
      do_not_phone        BOOLEAN NOT NULL DEFAULT FALSE,
      do_not_email_reason TEXT,
      do_not_email_at     TIMESTAMPTZ,

      unsubscribe_token   UUID NOT NULL DEFAULT gen_random_uuid(),

      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
      -- NOTE: email is intentionally NOT unique. Family members booking
      -- together often share one email address (a parent's inbox for the
      -- whole household) — enforcing uniqueness here rejected real, valid
      -- client data during import.
    )
  `);

  // Comprehensive defensive ALTER — a `contacts` table already exists from
  // an earlier attempt with a different/older shape, so CREATE TABLE IF NOT
  // EXISTS above was a no-op. This adds every column the CRM needs
  // regardless of what that existing table currently looks like.
  await pool.query(`
    ALTER TABLE contacts
      ADD COLUMN IF NOT EXISTS first_name                  TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS last_name                    TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS phone                        TEXT,
      ADD COLUMN IF NOT EXISTS company                      TEXT,
      ADD COLUMN IF NOT EXISTS city                         TEXT,
      ADD COLUMN IF NOT EXISTS country                      TEXT,
      ADD COLUMN IF NOT EXISTS tags                         TEXT[] NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS source                       TEXT NOT NULL DEFAULT 'manual',
      ADD COLUMN IF NOT EXISTS notes                        TEXT,
      ADD COLUMN IF NOT EXISTS custom_fields                JSONB NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS do_not_email                 BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS do_not_phone                 BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS do_not_email_reason           TEXT,
      ADD COLUMN IF NOT EXISTS do_not_email_at               TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS unsubscribe_token            UUID NOT NULL DEFAULT gen_random_uuid(),
      ADD COLUMN IF NOT EXISTS created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS address_line1                TEXT,
      ADD COLUMN IF NOT EXISTS address_line2                TEXT,
      ADD COLUMN IF NOT EXISTS region                        TEXT,
      ADD COLUMN IF NOT EXISTS postal_code                   TEXT,
      ADD COLUMN IF NOT EXISTS dietary_restrictions          TEXT[] NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS accessibility_needs           TEXT[] NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS special_requirements_notes    TEXT
  `);

  // One-time cleanup: your production `contacts` table predates this CRM
  // and already had `name` (required) + `do_not_phone` (legacy). Reconcile
  // rather than run two parallel "don't call" flags, and backfill
  // first_name so old contacts still show up correctly in the CRM UI.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contacts' AND column_name = 'do_not_call') THEN
        UPDATE contacts SET do_not_phone = TRUE WHERE do_not_call = TRUE AND do_not_phone = FALSE;
        ALTER TABLE contacts DROP COLUMN do_not_call;
      END IF;
    END $$;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contacts' AND column_name = 'name') THEN
        UPDATE contacts
        SET first_name = name
        WHERE (first_name IS NULL OR first_name = '')
          AND name IS NOT NULL AND name <> '';
      END IF;
    END $$;
  `);
  await pool.query(`
    ALTER TABLE contacts
      ADD COLUMN IF NOT EXISTS email CITEXT
  `);

  // NOTE: email is intentionally NOT unique. Family members booking together
  // often share one email address (e.g. a parent's inbox for the whole
  // household) — enforcing uniqueness here rejected real, valid client data.
  // If you need to avoid double-emailing a shared inbox during a campaign
  // send, de-duplicate by email at send time instead of at the database
  // constraint level.

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts (email)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_contacts_tags ON contacts USING GIN (tags)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_contacts_do_not_email ON contacts (do_not_email)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_contacts_dietary_restrictions ON contacts USING GIN (dietary_restrictions)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_contacts_accessibility_needs ON contacts USING GIN (accessibility_needs)`);

  await pool.query(`
    CREATE OR REPLACE FUNCTION set_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await pool.query(`DROP TRIGGER IF EXISTS trg_contacts_updated_at ON contacts`);
  await pool.query(`
    CREATE TRIGGER trg_contacts_updated_at
    BEFORE UPDATE ON contacts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);

  // ---------------------------------------------------------------------
  // Detailed client-profile fields (from the CRM xlsx import): legal name,
  // agent assignment, and formal consent tracking. Bolted onto the same
  // `contacts` table so a contact is a contact — one row, one identity —
  // rather than a second competing table.
  // ---------------------------------------------------------------------
  await pool.query(`
    ALTER TABLE contacts
      ADD COLUMN IF NOT EXISTS middle_name              TEXT,
      ADD COLUMN IF NOT EXISTS legal_full_name           TEXT,
      ADD COLUMN IF NOT EXISTS client_status             TEXT, -- VIP, CLIENT, FAMILY, REFERRAL, FRIEND
      ADD COLUMN IF NOT EXISTS assigned_agent            TEXT,
      ADD COLUMN IF NOT EXISTS household_id              TEXT,
      ADD COLUMN IF NOT EXISTS gender                    TEXT,
      ADD COLUMN IF NOT EXISTS nationality               TEXT,
      ADD COLUMN IF NOT EXISTS inquiry_id                INTEGER REFERENCES inquiries(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS data_consent              BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS passport_storage_consent  BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS marketing_consent         BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS consent_date_signed       TIMESTAMPTZ
  `);

  // Date of birth — sensitive PII, stored encrypted at rest and gated
  // behind reveal-sensitive in the app, matching the pattern used for
  // dietary_special_needs (see below) rather than the plaintext columns
  // above. Encryption/decryption happens in the application layer
  // (contactsCRM.js), same as the dietary/medical *_enc columns; this
  // column only ever holds ciphertext, never plaintext.
  await pool.query(`
    ALTER TABLE contacts
      ADD COLUMN IF NOT EXISTS dob_enc TEXT
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'contacts_legal_full_name_unique'
      ) THEN
        ALTER TABLE contacts ADD CONSTRAINT contacts_legal_full_name_unique UNIQUE (legal_full_name);
      END IF;
    END $$;
  `);

  // ---------------------------------------------------------------------
  // NOTE: Passport info is intentionally NOT stored anywhere in this
  // database. It was previously kept in a `passport_info` table
  // (encrypted passport number + metadata), but was removed as too
  // sensitive to have accessible from this app at all — even encrypted
  // and behind step-up auth. That table was dropped manually; nothing
  // here recreates it. The Excel import no longer reads or writes it
  // either — see importContacts.js.
  // ---------------------------------------------------------------------

  // ---------------------------------------------------------------------
  // Detailed dietary/medical info — one row per contact. Separate from the
  // legacy `dietary_restrictions`/`accessibility_needs` chip columns on
  // `contacts` (those are no longer written to — see contactsCRM.js —
  // this table is now the single source of truth for dietary/accessibility
  // data from BOTH the Excel import and the manual contact form, gated
  // behind reveal-sensitive since it's meaningfully sensitive detail).
  //
  // All six active encrypted columns (dietary_restrictions_enc,
  // food_allergies_enc, mobility_assistance_enc, accessibility_needs_enc,
  // medical_equipment_enc, other_notes_enc) are editable via the admin form
  // once revealed — see contactsCRM.js and ContactForm.jsx.
  // medical_equipment_needs_enc is retained in the table for backward
  // compatibility but is DEAD going forward: the form used to have two
  // separate "medical equipment" fields (a chip picker on this column and
  // a free-text field on medical_equipment_enc); they've been consolidated
  // into a single chip field backed by medical_equipment_enc, the column
  // the Excel import already writes to. Safe to drop this column in a
  // later migration once you're confident nothing reads it.
  // ---------------------------------------------------------------------
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dietary_special_needs (
      id                          SERIAL PRIMARY KEY,
      contact_id                  INTEGER NOT NULL UNIQUE REFERENCES contacts(id) ON DELETE CASCADE,
      dietary_restrictions_enc    TEXT,
      food_allergies_enc          TEXT,
      mobility_assistance_enc     TEXT,
      accessibility_needs_enc     TEXT,
      medical_equipment_enc       TEXT,
      medical_equipment_needs_enc TEXT,
      other_notes_enc             TEXT,
      updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  // Defensive ALTER for databases where this table already existed before
  // these columns were added.
  await pool.query(`
    ALTER TABLE dietary_special_needs
      ADD COLUMN IF NOT EXISTS accessibility_needs_enc TEXT,
      ADD COLUMN IF NOT EXISTS medical_equipment_needs_enc TEXT
  `);
  await pool.query(`DROP TRIGGER IF EXISTS trg_dietary_special_needs_updated_at ON dietary_special_needs`);
  await pool.query(`
    CREATE TRIGGER trg_dietary_special_needs_updated_at
    BEFORE UPDATE ON dietary_special_needs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);

  // ---------------------------------------------------------------------
  // Emergency contacts — many per contact.
  // ---------------------------------------------------------------------
  await pool.query(`
    CREATE TABLE IF NOT EXISTS emergency_contacts (
      id            SERIAL PRIMARY KEY,
      contact_id    INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      relationship  TEXT,
      phone         TEXT,
      email         TEXT
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_emergency_contacts_contact ON emergency_contacts (contact_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id            SERIAL PRIMARY KEY,
      subject       TEXT NOT NULL,
      html_body     TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'sending' | 'sent' | 'failed'
      filter_tags   TEXT[] NOT NULL DEFAULT '{}',
      created_by    TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      sent_at       TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_recipients (
      id            SERIAL PRIMARY KEY,
      campaign_id   INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      contact_id    INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      status        TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'sent' | 'skipped_dnc' | 'failed'
      error         TEXT,
      sent_at       TIMESTAMPTZ,
      UNIQUE (campaign_id, contact_id)
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign ON campaign_recipients (campaign_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_campaign_recipients_status ON campaign_recipients (campaign_id, status)`);

  console.log('Database ready');
}

module.exports = { pool, initDb };