// server/routes/contactsCRM.js
//
// Mounted in index.js as: app.use('/api/contacts', authMiddleware, crmContactsRoutes);
// Plain pg queries throughout — no ORM, no migration tool. Every statement
// here only ever touches `contacts`, `passport_info`, `dietary_special_needs`,
// and `emergency_contacts` — nothing else in the database.

const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const { pool } = require('../db');
const { decryptField, maskValue } = require('../utils/encryption');
const { importContactsFromWorkbook } = require('../utils/importContacts');
const requireStepUpAuth = require('../middleware/requireStepUpAuth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const BASIC_COLUMNS = `
  id, first_name, last_name, middle_name, legal_full_name, email, phone, company,
  city, country, region, postal_code, address_line1, address_line2,
  tags, notes, do_not_email, do_not_phone,
  dietary_restrictions, accessibility_needs, special_requirements_notes,
  client_status, assigned_agent, household_id, gender, nationality,
  data_consent, passport_storage_consent, marketing_consent, consent_date_signed,
  created_at, updated_at
`;

// Same columns, qualified with the `c.` alias for use in JOIN queries where
// `contacts` isn't the only table in the FROM clause.
const BASIC_COLUMNS_QUALIFIED = BASIC_COLUMNS
  .split(',')
  .map((col) => `c.${col.trim()}`)
  .join(', ');

/**
 * GET /api/contacts?search=&page=&pageSize=
 * Returns { contacts, total }. A masked passport preview is included via a
 * LEFT JOIN, but the full number is never decrypted here.
 */
router.get('/', async (req, res) => {
  try {
    const search = (req.query.search || '').trim();
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(parseInt(req.query.pageSize, 10) || 25, 200);
    const offset = (page - 1) * pageSize;

    const whereClause = search
      ? `WHERE c.first_name ILIKE $1 OR c.last_name ILIKE $1 OR c.legal_full_name ILIKE $1
         OR c.email ILIKE $1 OR c.company ILIKE $1`
      : '';
    const searchParam = search ? [`%${search}%`] : [];

    const listResult = await pool.query(
      `
      SELECT ${BASIC_COLUMNS_QUALIFIED}, p.passport_number_enc
      FROM contacts c
      LEFT JOIN passport_info p ON p.contact_id = c.id
      ${whereClause}
      ORDER BY c.last_name ASC, c.first_name ASC
      LIMIT $${searchParam.length + 1} OFFSET $${searchParam.length + 2}
      `,
      [...searchParam, pageSize, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM contacts c ${whereClause}`,
      searchParam
    );

    const contacts = listResult.rows.map((row) => {
      let passportPreview = null;
      try {
        passportPreview = maskValue(decryptField(row.passport_number_enc));
      } catch {
        passportPreview = null;
      }
      const { passport_number_enc, ...rest } = row;
      return { ...rest, passportPreview };
    });

    res.json({ contacts, total: parseInt(countResult.rows[0].count, 10) });
  } catch (err) {
    console.error('GET /contacts error:', err);
    res.status(500).json({ error: 'Failed to load contacts' });
  }
});

/**
 * GET /api/contacts/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid contact id' });

    const contactResult = await pool.query(
      `SELECT ${BASIC_COLUMNS} FROM contacts WHERE id = $1`,
      [id]
    );
    if (contactResult.rows.length === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    const emergencyResult = await pool.query(
      `SELECT id, name, relationship, phone, email FROM emergency_contacts WHERE contact_id = $1`,
      [id]
    );
    const hasPassport = await pool.query(
      `SELECT id, country_of_issue, visa_required, updated_at FROM passport_info WHERE contact_id = $1`,
      [id]
    );
    const hasDietary = await pool.query(
      `SELECT id, updated_at FROM dietary_special_needs WHERE contact_id = $1`,
      [id]
    );

    res.json({
      ...contactResult.rows[0],
      emergency_contacts: emergencyResult.rows,
      passport_info: hasPassport.rows[0] || null,
      dietary_special_needs: hasDietary.rows[0] || null,
    });
  } catch (err) {
    console.error('GET /contacts/:id error:', err);
    res.status(500).json({ error: 'Failed to load contact' });
  }
});

/**
 * POST /api/contacts
 */
router.post('/', async (req, res) => {
  try {
    const b = req.body;
    const result = await pool.query(
      `
      INSERT INTO contacts (
        first_name, last_name, email, phone, company,
        address_line1, address_line2, city, region, postal_code, country,
        tags, notes, do_not_email, do_not_phone,
        dietary_restrictions, accessibility_needs, special_requirements_notes,
        source
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'manual')
      RETURNING ${BASIC_COLUMNS}
      `,
      [
        b.first_name || '', b.last_name || '', b.email || null, b.phone || null, b.company || null,
        b.address_line1 || null, b.address_line2 || null, b.city || null, b.region || null,
        b.postal_code || null, b.country || null,
        b.tags || [], b.notes || null, !!b.do_not_email, !!b.do_not_phone,
        b.dietary_restrictions || [], b.accessibility_needs || [], b.special_requirements_notes || null,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A contact with this email already exists' });
    }
    console.error('POST /contacts error:', err);
    res.status(500).json({ error: 'Failed to create contact' });
  }
});

/**
 * PUT /api/contacts/:id
 */
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid contact id' });

    const b = req.body;
    const result = await pool.query(
      `
      UPDATE contacts SET
        first_name = $1, last_name = $2, email = $3, phone = $4, company = $5,
        address_line1 = $6, address_line2 = $7, city = $8, region = $9, postal_code = $10, country = $11,
        tags = $12, notes = $13, do_not_email = $14, do_not_phone = $15,
        dietary_restrictions = $16, accessibility_needs = $17, special_requirements_notes = $18
      WHERE id = $19
      RETURNING ${BASIC_COLUMNS}
      `,
      [
        b.first_name || '', b.last_name || '', b.email || null, b.phone || null, b.company || null,
        b.address_line1 || null, b.address_line2 || null, b.city || null, b.region || null,
        b.postal_code || null, b.country || null,
        b.tags || [], b.notes || null, !!b.do_not_email, !!b.do_not_phone,
        b.dietary_restrictions || [], b.accessibility_needs || [], b.special_requirements_notes || null,
        id,
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A contact with this email already exists' });
    }
    console.error('PUT /contacts/:id error:', err);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

/**
 * DELETE /api/contacts/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid contact id' });

    const result = await pool.query(`DELETE FROM contacts WHERE id = $1`, [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    res.status(204).end();
  } catch (err) {
    console.error('DELETE /contacts/:id error:', err);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

/**
 * POST /api/contacts/:id/reveal-sensitive
 * Step-up gated. Body must include { reauthPassword }.
 */
router.post('/:id/reveal-sensitive', requireStepUpAuth, async (req, res) => {
  try {
    if (!req.sensitiveAccessGranted) {
      return res.status(401).json({ error: 'Step-up authentication required' });
    }

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid contact id' });

    const passportResult = await pool.query(
      `SELECT * FROM passport_info WHERE contact_id = $1`,
      [id]
    );
    const dietaryResult = await pool.query(
      `SELECT * FROM dietary_special_needs WHERE contact_id = $1`,
      [id]
    );

    const p = passportResult.rows[0];
    const d = dietaryResult.rows[0];

    res.json({
      passport: p && {
        passportNumber: decryptField(p.passport_number_enc),
        countryOfIssue: p.country_of_issue,
        issueDate: p.issue_date,
        expirationDate: p.expiration_date,
        visaRequired: p.visa_required,
        notes: p.notes,
      },
      dietarySpecialNeeds: d && {
        dietaryRestrictions: decryptField(d.dietary_restrictions_enc),
        foodAllergies: decryptField(d.food_allergies_enc),
        mobilityAssistance: decryptField(d.mobility_assistance_enc),
        medicalEquipment: decryptField(d.medical_equipment_enc),
        otherNotes: decryptField(d.other_notes_enc),
      },
    });
  } catch (err) {
    console.error('POST /contacts/:id/reveal-sensitive error:', err);
    res.status(500).json({ error: 'Failed to decrypt sensitive information' });
  }
});

/**
 * POST /api/contacts/import
 */
router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const result = await importContactsFromWorkbook(req.file.buffer);
    res.json({
      message: `Imported ${result.created} new and updated ${result.updated} existing contacts.`,
      ...result,
    });
  } catch (err) {
    console.error('POST /contacts/import error:', err);
    res.status(500).json({ error: 'Import failed', details: err.message });
  }
});

module.exports = router;