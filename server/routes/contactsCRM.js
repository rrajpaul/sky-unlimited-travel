// server/routes/contactsCRM.js
//
// Mounted in index.js as: app.use('/api/contacts', authMiddleware, crmContactsRoutes);
// Plain pg queries throughout — no ORM, no migration tool. Every statement
// here only ever touches `contacts`, `dietary_special_needs`, and
// `emergency_contacts` — nothing else in the database.
//
// Passport data is intentionally NOT handled here, or anywhere in this app —
// it isn't imported, stored, decrypted, or displayed. See db.js and
// importContacts.js for more.
//
// Dietary/accessibility/medical/special-requirements data (whether it came
// from the Excel import OR was typed/edited into the manual contact form)
// lives ONLY in the encrypted `dietary_special_needs` table, gated behind
// reveal-sensitive. `contacts.dietary_restrictions` / `accessibility_needs` /
// `special_requirements_notes` are no longer read or written here — those
// plain columns are dead going forward (safe to drop in a later migration
// once you're confident nothing else reads them).
//
// Date of birth follows the same reveal-sensitive pattern as the dietary
// fields, but lives directly on `contacts.dob_enc` (single column, no
// separate table needed for one field). BASIC_COLUMNS deliberately does
// NOT include dob_enc — list/detail responses only ever expose a boolean
// `hasDob` flag (computed via `dob_enc IS NOT NULL`, no decryption), and
// the ciphertext itself is only ever decrypted in reveal-sensitive, same
// as the dietary columns.
//
// All six active encrypted dietary columns (dietary_restrictions_enc,
// accessibility_needs_enc, food_allergies_enc, mobility_assistance_enc,
// medical_equipment_enc, other_notes_enc) plus dob_enc are editable via the
// form — see upsertManualDietaryFields() and the dob handling in POST/PUT
// below. Editing any one field only overwrites that column; the form
// always reloads current values on reveal first, so untouched fields
// round-trip unchanged rather than being blanked out.
//
// medical_equipment_needs_enc is DEAD going forward — the form used to
// have two separate "medical equipment" fields (one chip picker on this
// column, one free-text on medical_equipment_enc); they've been
// consolidated into a single chip field backed by medical_equipment_enc
// (the column the Excel import already writes to — see
// importContacts.js). Nothing here reads or writes
// medical_equipment_needs_enc anymore; safe to drop in a later migration
// once you're confident nothing else reads it. Any pre-existing data in
// that column for contacts edited before this change is NOT migrated
// automatically and will no longer surface anywhere in the app.
//
// dietary_restrictions_enc, accessibility_needs_enc, mobility_assistance_enc,
// medical_equipment_enc, and food_allergies_enc are all chip-array fields
// (serializeChips / parseMaybeChips) — each may hold a JSON array (manual
// chip selections) or a plain string (older imported free text that
// hasn't been re-normalized into chips yet). Only other_notes_enc remains
// genuinely free text.
//
// WRITE-SIDE PROTECTION: PUT /:id requires the reauth password (same
// mechanism as reveal-sensitive) before it will CHANGE a sensitive field
// that already had a non-empty value — see fieldRequiresStepUp() below.
// It does NOT require a password for: fields the request simply didn't
// include (the admin never revealed that section — those are preserved
// untouched, not overwritten), or first-time entry into a field that was
// previously empty (nothing existed yet to protect, matching the
// read-side reveal gate's own "only lock a section that already has
// something in it" rule). POST / (create) never requires this at all —
// a brand-new contact has nothing pre-existing to protect.

const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const { pool } = require('../db');
const { encryptField, decryptField } = require('../utils/encryption');
const { importContactsFromWorkbook } = require('../utils/importContacts');
const requireStepUpAuth = require('../middleware/requireStepUpAuth');
const { verifyReauthPassword } = requireStepUpAuth;

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

// Encrypts a DOB value for storage. Expects 'YYYY-MM-DD' (what a <input
// type="date"> sends) or empty/undefined to clear it.
function encryptDob(dob) {
  return encryptField(dob ? String(dob).trim() || null : null);
}

// --- Helpers for the write-side step-up check on PUT /:id ---
//
// A sensitive field should only ever require the reauth password when a
// request is actually CHANGING data that already existed — never for:
//   (a) a field the request didn't include at all (key absent — the admin
//       never revealed this section, so nothing was touched), or
//   (b) first-time entry into a field that was previously empty (nothing
//       existed yet to protect — matches the read-side reveal gate, which
//       also only locks a contact's sensitive section when it already
//       has something stored there).
// Only "existing non-empty value is being changed or cleared" requires
// step-up.

function isNonEmptyValue(v) {
  if (Array.isArray(v)) return v.filter(Boolean).length > 0;
  return !!(v && String(v).trim());
}

function arraysEqual(a, b) {
  const arrA = [].concat(a || []).filter(Boolean).map(String).sort();
  const arrB = [].concat(b || []).filter(Boolean).map(String).sort();
  if (arrA.length !== arrB.length) return false;
  return arrA.every((v, i) => v === arrB[i]);
}

function textEqual(a, b) {
  return (a || '').toString().trim() === (b || '').toString().trim();
}

// keyPresent: whether the request body included this key at all.
// existing: the current decrypted value for this field.
// incoming: the submitted value for this field (only meaningful if
//   keyPresent is true).
// isArray: whether to compare as a chip array vs. plain text.
function fieldRequiresStepUp(keyPresent, existing, incoming, isArray) {
  if (!keyPresent) return false;
  if (!isNonEmptyValue(existing)) return false;
  return isArray ? !arraysEqual(existing, incoming) : !textEqual(existing, incoming);
}

// Normalizes to Proper Case on save — "mary-jane o'connor" -> "Mary-Jane
// O'Connor", "123 main st" -> "123 Main St". Capitalizes the first letter
// after the start of the string, a space, a hyphen, or an apostrophe;
// lowercases everything else. Scoped to first_name/last_name/middle_name,
// address_line1 (Street Address), city, and region (State/Province) —
// NOT legal_full_name, which must stay exactly as typed since the form
// warns changing it breaks re-import matching by name, and NOT
// address_line2, since apartment/unit/suite values (e.g. "Apt 4B", "PO
// Box 5") commonly mix case in ways this simple word-capitalization rule
// gets wrong (it would lowercase the "B" in "4B", since that letter
// follows a digit rather than a separator).
function toProperCase(value) {
  if (value === null || value === undefined) return value;
  const str = String(value);
  if (!str.trim()) return str;
  return str
    .toLowerCase()
    .replace(/(^|[\s\-'])([a-z])/g, (_match, sep, char) => sep + char.toUpperCase());
}

// Upserts all six encrypted dietary/accessibility/medical columns from
// whatever the form submitted. For each field: if the request didn't
// include that key at all, preserve whatever's already in existingRow
// rather than blanking it — this is what makes it safe for a PUT that
// never revealed the sensitive section to still update unrelated fields
// without wiping this contact's dietary/medical data. If the key IS
// present (even as an empty value, meaning "intentionally clear this"),
// it overwrites just that column.
async function upsertManualDietaryFields(contactId, existingRow, {
  dietaryRestrictions, accessibilityNeeds,
  foodAllergies, mobilityAssistance, medicalEquipment,
  specialRequirementsNotes,
}) {
  const dietaryEnc = dietaryRestrictions === undefined
    ? (existingRow?.dietary_restrictions_enc ?? null)
    : encryptField(serializeChips(dietaryRestrictions));
  const accessibilityEnc = accessibilityNeeds === undefined
    ? (existingRow?.accessibility_needs_enc ?? null)
    : encryptField(serializeChips(accessibilityNeeds));
  const foodAllergiesEnc = foodAllergies === undefined
    ? (existingRow?.food_allergies_enc ?? null)
    : encryptField(serializeChips(foodAllergies));
  const mobilityAssistanceEnc = mobilityAssistance === undefined
    ? (existingRow?.mobility_assistance_enc ?? null)
    : encryptField(serializeChips(mobilityAssistance));
  const medicalEquipmentEnc = medicalEquipment === undefined
    ? (existingRow?.medical_equipment_enc ?? null)
    : encryptField(serializeChips(medicalEquipment));
  const notesEnc = specialRequirementsNotes === undefined
    ? (existingRow?.other_notes_enc ?? null)
    : encryptField(specialRequirementsNotes ? String(specialRequirementsNotes).trim() || null : null);

  const values = [dietaryEnc, accessibilityEnc, foodAllergiesEnc, mobilityAssistanceEnc, medicalEquipmentEnc, notesEnc];
  const hasAnyData = values.some((v) => v !== null && v !== undefined);
  if (!hasAnyData) return;

  await pool.query(
    `
    INSERT INTO dietary_special_needs (
      contact_id, dietary_restrictions_enc, accessibility_needs_enc,
      food_allergies_enc, mobility_assistance_enc, medical_equipment_enc, other_notes_enc
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (contact_id) DO UPDATE SET
      dietary_restrictions_enc = EXCLUDED.dietary_restrictions_enc,
      accessibility_needs_enc = EXCLUDED.accessibility_needs_enc,
      food_allergies_enc = EXCLUDED.food_allergies_enc,
      mobility_assistance_enc = EXCLUDED.mobility_assistance_enc,
      medical_equipment_enc = EXCLUDED.medical_equipment_enc,
      other_notes_enc = EXCLUDED.other_notes_enc
    `,
    [contactId, ...values]
  );
}

/**
 * GET /api/contacts?search=&page=&pageSize=
 * Returns { contacts, total }. We LEFT JOIN dietary_special_needs solely to
 * know whether a row exists for this contact (hasDietaryData), and check
 * dob_enc IS NOT NULL for hasDob — the encrypted fields themselves are
 * never selected or decrypted on the list endpoint, only on
 * reveal-sensitive.
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
      SELECT ${BASIC_COLUMNS_QUALIFIED}, d.id AS dietary_id, (c.dob_enc IS NOT NULL) AS has_dob
      FROM contacts c
      LEFT JOIN dietary_special_needs d ON d.contact_id = c.id
      ${whereClause}
      ORDER BY c.legal_full_name ASC NULLS LAST, c.last_name ASC, c.first_name ASC
      LIMIT $${searchParam.length + 1} OFFSET $${searchParam.length + 2}
      `,
      [...searchParam, pageSize, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM contacts c ${whereClause}`,
      searchParam
    );

    const contacts = listResult.rows.map((row) => {
      const { dietary_id, has_dob, ...rest } = row;
      return { ...rest, hasDietaryData: dietary_id != null, hasDob: !!has_dob };
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
      `SELECT ${BASIC_COLUMNS}, (dob_enc IS NOT NULL) AS has_dob FROM contacts WHERE id = $1`,
      [id]
    );
    if (contactResult.rows.length === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    const emergencyResult = await pool.query(
      `SELECT id, name, relationship, phone, email FROM emergency_contacts WHERE contact_id = $1`,
      [id]
    );
    const hasDietary = await pool.query(
      `SELECT id, updated_at FROM dietary_special_needs WHERE contact_id = $1`,
      [id]
    );

    const { has_dob, ...contact } = contactResult.rows[0];

    res.json({
      ...contact,
      hasDob: !!has_dob,
      emergency_contacts: emergencyResult.rows,
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
        first_name, last_name, middle_name, legal_full_name, email, phone, company,
        client_status,
        address_line1, address_line2, city, region, postal_code, country,
        tags, notes, do_not_email, do_not_phone, dob_enc,
        source
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'manual')
      RETURNING ${BASIC_COLUMNS}
      `,
      [
        toProperCase(b.first_name) || '', toProperCase(b.last_name) || '', toProperCase(b.middle_name) || null, b.legal_full_name || null,
        b.email || null, b.phone || null, b.company || null,
        b.client_status || null,
        toProperCase(b.address_line1) || null, b.address_line2 || null, toProperCase(b.city) || null, toProperCase(b.region) || null,
        b.postal_code || null, b.country || null,
        b.tags || [], b.notes || null, !!b.do_not_email, !!b.do_not_phone,
        encryptDob(b.dob),
      ]
    );
    const contact = result.rows[0];

    await upsertManualDietaryFields(contact.id, null, {
      dietaryRestrictions: b.dietary_restrictions,
      accessibilityNeeds: b.accessibility_needs,
      foodAllergies: b.food_allergies,
      mobilityAssistance: b.mobility_assistance,
      medicalEquipment: b.medical_equipment,
      specialRequirementsNotes: b.special_requirements_notes,
    });

    res.status(201).json({ ...contact, hasDob: !!b.dob });
  } catch (err) {
    if (err.code === '23505') {
      if (err.constraint === 'contacts_legal_full_name_unique') {
        return res.status(409).json({ error: 'A contact with this legal full name already exists' });
      }
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

    // Fetch existing sensitive data BEFORE writing anything. Needed for
    // two things at once: (1) detecting whether this request is actually
    // changing previously-existing sensitive data (the only case that
    // requires the reauth password — see fieldRequiresStepUp above), and
    // (2) preserving whatever's already there for any sensitive field
    // this request didn't include at all (the admin never revealed that
    // section, so the form omitted these keys rather than sending blanks
    // that would otherwise silently wipe existing DOB/dietary data).
    const existingContactResult = await pool.query(
      `SELECT dob_enc FROM contacts WHERE id = $1`,
      [id]
    );
    if (existingContactResult.rows.length === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    const existingDobEnc = existingContactResult.rows[0].dob_enc;
    const existingDob = existingDobEnc ? decryptField(existingDobEnc) : null;

    const existingDietaryResult = await pool.query(
      `SELECT * FROM dietary_special_needs WHERE contact_id = $1`,
      [id]
    );
    const existingDietaryRow = existingDietaryResult.rows[0] || null;
    const existingDietary = existingDietaryRow ? {
      dietaryRestrictions: parseMaybeChips(decryptField(existingDietaryRow.dietary_restrictions_enc)),
      accessibilityNeeds: parseMaybeChips(decryptField(existingDietaryRow.accessibility_needs_enc)),
      foodAllergies: parseMaybeChips(decryptField(existingDietaryRow.food_allergies_enc)),
      mobilityAssistance: parseMaybeChips(decryptField(existingDietaryRow.mobility_assistance_enc)),
      medicalEquipment: parseMaybeChips(decryptField(existingDietaryRow.medical_equipment_enc)),
      otherNotes: decryptField(existingDietaryRow.other_notes_enc),
    } : {};

    const sensitiveChanged =
      fieldRequiresStepUp('dob' in b, existingDob, b.dob, false) ||
      fieldRequiresStepUp('dietary_restrictions' in b, existingDietary.dietaryRestrictions, b.dietary_restrictions, true) ||
      fieldRequiresStepUp('accessibility_needs' in b, existingDietary.accessibilityNeeds, b.accessibility_needs, true) ||
      fieldRequiresStepUp('food_allergies' in b, existingDietary.foodAllergies, b.food_allergies, true) ||
      fieldRequiresStepUp('mobility_assistance' in b, existingDietary.mobilityAssistance, b.mobility_assistance, true) ||
      fieldRequiresStepUp('medical_equipment' in b, existingDietary.medicalEquipment, b.medical_equipment, true) ||
      fieldRequiresStepUp('special_requirements_notes' in b, existingDietary.otherNotes, b.special_requirements_notes, false);

    if (sensitiveChanged) {
      if (!b.reauthPassword) {
        return res.status(401).json({
          error: 'Password re-entry required to change sensitive information',
          code: 'STEP_UP_REQUIRED',
        });
      }
      const passwordOk = await verifyReauthPassword(req);
      if (!passwordOk) {
        return res.status(401).json({ error: 'Incorrect password' });
      }
    }

    // Preserve dob_enc unchanged if the request didn't include a 'dob'
    // key at all (section never revealed); otherwise write whatever was
    // submitted, including clearing it if b.dob is empty.
    const dobEncToWrite = ('dob' in b) ? encryptDob(b.dob) : existingDobEnc;

    const result = await pool.query(
      `
      UPDATE contacts SET
        first_name = $1, last_name = $2, middle_name = $3, legal_full_name = $4,
        email = $5, phone = $6, company = $7, client_status = $8,
        address_line1 = $9, address_line2 = $10, city = $11, region = $12, postal_code = $13, country = $14,
        tags = $15, notes = $16, do_not_email = $17, do_not_phone = $18, dob_enc = $19
      WHERE id = $20
      RETURNING ${BASIC_COLUMNS}
      `,
      [
        toProperCase(b.first_name) || '', toProperCase(b.last_name) || '', toProperCase(b.middle_name) || null, b.legal_full_name || null,
        b.email || null, b.phone || null, b.company || null, b.client_status || null,
        toProperCase(b.address_line1) || null, b.address_line2 || null, toProperCase(b.city) || null, toProperCase(b.region) || null,
        b.postal_code || null, b.country || null,
        b.tags || [], b.notes || null, !!b.do_not_email, !!b.do_not_phone,
        dobEncToWrite,
        id,
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // For each of the six dietary/medical columns: a key absent from the
    // request preserves existingDietaryRow's value untouched (see
    // upsertManualDietaryFields); a key present overwrites just that
    // column, same as before.
    await upsertManualDietaryFields(id, existingDietaryRow, {
      dietaryRestrictions: b.dietary_restrictions,
      accessibilityNeeds: b.accessibility_needs,
      foodAllergies: b.food_allergies,
      mobilityAssistance: b.mobility_assistance,
      medicalEquipment: b.medical_equipment,
      specialRequirementsNotes: b.special_requirements_notes,
    });

    res.json({ ...result.rows[0], hasDob: dobEncToWrite != null });
  } catch (err) {
    if (err.code === '23505') {
      if (err.constraint === 'contacts_legal_full_name_unique') {
        return res.status(409).json({ error: 'A contact with this legal full name already exists' });
      }
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
 * Returns decrypted DOB and dietary/accessibility/medical data only —
 * passport is not stored anywhere in this app.
 */
router.post('/:id/reveal-sensitive', requireStepUpAuth, async (req, res) => {
  try {
    if (!req.sensitiveAccessGranted) {
      return res.status(401).json({ error: 'Step-up authentication required' });
    }

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid contact id' });

    const contactResult = await pool.query(
      `SELECT dob_enc FROM contacts WHERE id = $1`,
      [id]
    );
    if (contactResult.rows.length === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    const dietaryResult = await pool.query(
      `SELECT * FROM dietary_special_needs WHERE contact_id = $1`,
      [id]
    );

    const d = dietaryResult.rows[0];
    const dobEnc = contactResult.rows[0].dob_enc;

    res.json({
      dob: dobEnc ? decryptField(dobEnc) : null,
      dietarySpecialNeeds: d && {
        // dietaryRestrictions/accessibilityNeeds/mobilityAssistance/
        // medicalEquipment may be a JSON array (manual chips) or a plain
        // string (imported free text) — parseMaybeChips returns whichever
        // shape it actually is.
        dietaryRestrictions: parseMaybeChips(decryptField(d.dietary_restrictions_enc)),
        foodAllergies: parseMaybeChips(decryptField(d.food_allergies_enc)),
        mobilityAssistance: parseMaybeChips(decryptField(d.mobility_assistance_enc)),
        accessibilityNeeds: parseMaybeChips(decryptField(d.accessibility_needs_enc)),
        medicalEquipment: parseMaybeChips(decryptField(d.medical_equipment_enc)),
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