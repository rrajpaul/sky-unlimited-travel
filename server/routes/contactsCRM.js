// server/routes/contactsCRM.js
//
// Mounted in index.js as: app.use('/api/contacts', authMiddleware, crmContactsRoutes);
// Plain pg queries throughout — no ORM, no migration tool. Every statement
// here only ever touches `contacts`, `passport_info`, `dietary_special_needs`,
// and `emergency_contacts` — nothing else in the database.
//
// Dietary/accessibility/special-requirements data (whether it came from the
// Excel import OR was typed into the manual contact form) now lives ONLY in
// the encrypted `dietary_special_needs` table, gated behind reveal-sensitive.
// `contacts.dietary_restrictions` / `contacts.accessibility_needs` /
// `contacts.special_requirements_notes` are no longer read or written here —
// those plain columns are dead going forward (safe to drop in a later
// migration once you're confident nothing else reads them).
//
// The manual form only has three concepts (dietary chips, accessibility
// chips, a free-text note), which map onto three of the five encrypted
// columns: dietary_restrictions_enc, accessibility_needs_enc, other_notes_enc.
// Writes from the manual form deliberately never touch food_allergies_enc or
// medical_equipment_enc, so editing a contact's chips can never wipe out
// detail that came from an Excel import — see upsertManualDietaryFields().

const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const { pool } = require('../db');
const { encryptField, decryptField, maskValue } = require('../utils/encryption');
const { importContactsFromWorkbook } = require('../utils/importContacts');
const requireStepUpAuth = require('../middleware/requireStepUpAuth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const BASIC_COLUMNS = `
  id, first_name, last_name, middle_name, legal_full_name, email, phone, company,
  city, country, region, postal_code, address_line1, address_line2,
  tags, notes, do_not_email, do_not_phone,
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

// Chip fields (dietary_restrictions, accessibility_needs) are arrays in the
// UI. Import data in the same columns is a plain free-text string (e.g.
// "BA", "WHEELCHAIR"). We store chips as a JSON string so both shapes can
// live in the same text column, and parse defensively on the way out.
function serializeChips(value) {
  if (Array.isArray(value)) {
    return value.length ? JSON.stringify(value) : null;
  }
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

function parseMaybeChips(value) {
  if (value === null || value === undefined) return value;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Not JSON — it's a plain imported string, return as-is.
  }
  return value;
}

// Upserts ONLY the three columns the manual form owns. food_allergies_enc
// and medical_equipment_enc are never included here, so any values an
// import previously wrote to this row are left completely untouched.
async function upsertManualDietaryFields(contactId, { dietaryRestrictions, accessibilityNeeds, specialRequirementsNotes }) {
  const dietaryEnc = encryptField(serializeChips(dietaryRestrictions));
  const accessibilityEnc = encryptField(serializeChips(accessibilityNeeds));
  const notesEnc = encryptField(specialRequirementsNotes ? String(specialRequirementsNotes).trim() || null : null);

  const hasAnyData = [dietaryEnc, accessibilityEnc, notesEnc].some((v) => v !== null && v !== undefined);
  if (!hasAnyData) return;

  await pool.query(
    `
    INSERT INTO dietary_special_needs (contact_id, dietary_restrictions_enc, accessibility_needs_enc, other_notes_enc)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (contact_id) DO UPDATE SET
      dietary_restrictions_enc = EXCLUDED.dietary_restrictions_enc,
      accessibility_needs_enc = EXCLUDED.accessibility_needs_enc,
      other_notes_enc = EXCLUDED.other_notes_enc
    `,
    [contactId, dietaryEnc, accessibilityEnc, notesEnc]
  );
}

/**
 * GET /api/contacts?search=&page=&pageSize=
 * Returns { contacts, total }. A masked passport preview is included via a
 * LEFT JOIN, but the full number is never decrypted here. We also LEFT JOIN
 * dietary_special_needs solely to know whether a row exists for this
 * contact (hasDietaryData) — the encrypted fields themselves are never
 * selected or decrypted on the list endpoint, only on reveal-sensitive.
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
      SELECT ${BASIC_COLUMNS_QUALIFIED}, p.passport_number_enc, d.id AS dietary_id
      FROM contacts c
      LEFT JOIN passport_info p ON p.contact_id = c.id
      LEFT JOIN dietary_special_needs d ON d.contact_id = c.id
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
      const { passport_number_enc, dietary_id, ...rest } = row;
      return { ...rest, passportPreview, hasDietaryData: dietary_id != null };
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
        source
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'manual')
      RETURNING ${BASIC_COLUMNS}
      `,
      [
        b.first_name || '', b.last_name || '', b.email || null, b.phone || null, b.company || null,
        b.address_line1 || null, b.address_line2 || null, b.city || null, b.region || null,
        b.postal_code || null, b.country || null,
        b.tags || [], b.notes || null, !!b.do_not_email, !!b.do_not_phone,
      ]
    );
    const contact = result.rows[0];

    await upsertManualDietaryFields(contact.id, {
      dietaryRestrictions: b.dietary_restrictions,
      accessibilityNeeds: b.accessibility_needs,
      specialRequirementsNotes: b.special_requirements_notes,
    });

    res.status(201).json(contact);
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
        tags = $12, notes = $13, do_not_email = $14, do_not_phone = $15
      WHERE id = $16
      RETURNING ${BASIC_COLUMNS}
      `,
      [
        b.first_name || '', b.last_name || '', b.email || null, b.phone || null, b.company || null,
        b.address_line1 || null, b.address_line2 || null, b.city || null, b.region || null,
        b.postal_code || null, b.country || null,
        b.tags || [], b.notes || null, !!b.do_not_email, !!b.do_not_phone,
        id,
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Only touches dietary_restrictions_enc / accessibility_needs_enc /
    // other_notes_enc — food_allergies_enc and medical_equipment_enc (import
    // only) are left exactly as they were, whether this contact was
    // originally imported or not.
    await upsertManualDietaryFields(id, {
      dietaryRestrictions: b.dietary_restrictions,
      accessibilityNeeds: b.accessibility_needs,
      specialRequirementsNotes: b.special_requirements_notes,
    });

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
        // dietaryRestrictions/accessibilityNeeds may be a JSON array (manual
        // chips) or a plain string (imported free text) — parseMaybeChips
        // returns whichever shape it actually is.
        dietaryRestrictions: parseMaybeChips(decryptField(d.dietary_restrictions_enc)),
        foodAllergies: decryptField(d.food_allergies_enc),
        mobilityAssistance: decryptField(d.mobility_assistance_enc),
        accessibilityNeeds: parseMaybeChips(decryptField(d.accessibility_needs_enc)),
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