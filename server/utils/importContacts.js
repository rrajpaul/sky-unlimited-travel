// server/utils/importContacts.js
//
// Parses the multi-sheet CRM export and upserts contacts using plain pg
// queries (INSERT ... ON CONFLICT). No ORM, no migration tool involved.
//
// DATA-QUALITY NOTES (found via dry-run testing against the real file):
// - Sheet names: "Address" and "Dietary & Special Needs" (the "Passport
//   Info" sheet is intentionally never read — passport data is not stored
//   anywhere in this app; see db.js for why).
// - The "Legal Full Name" cell on the Client Index sheet is sometimes
//   INCOMPLETE even though the separate First/Middle/Last columns are
//   correct, so the join key is BUILT from those three columns.
// - Row position is NOT reliable between sheets — every join is by
//   normalized name.
// - A handful of names still won't match due to genuine spelling
//   differences between sheets. These are reported in the unmatched*
//   arrays for manual review rather than silently dropped or guessed at.
//
// Requires the "xlsx" package: npm install xlsx

const XLSX = require('xlsx');
const crypto = require('crypto');
const { pool } = require('../db');
const { encryptField } = require('./encryption');

function normalizeName(name) {
  return String(name || '').trim().toUpperCase().split(/\s+/).join('');
}

function sheetToRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: null });
}

function pick(row, ...possibleKeys) {
  for (const key of possibleKeys) {
    const foundKey = Object.keys(row).find(
      (k) => k.trim().toLowerCase() === key.trim().toLowerCase()
    );
    if (foundKey && row[foundKey] !== null && row[foundKey] !== undefined && row[foundKey] !== '') {
      return row[foundKey];
    }
  }
  return null;
}

function parseBoolean(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim().toLowerCase();
  if (['yes', 'true', 'y', '1'].includes(str)) return true;
  if (['no', 'false', 'n', '0'].includes(str)) return false;
  return null;
}

// Medical Equipment is the one dietary/special-needs field editable as
// chips in the admin form (see ContactForm.jsx), supporting single or
// multiple values. Import cells may hold one item ("Wheelchair") or
// several, comma/semicolon separated ("CPAP machine, Oxygen tank") — this
// splits either into a JSON array string in the same shape
// contactsCRM.js's serializeChips() produces, so imported and
// manually-entered data are indistinguishable on reveal. Scoped to this
// field only — Dietary Restrictions/Food Allergies/Mobility Assistance/
// Other Notes are intentionally left as raw imported strings, unchanged.
function parseMedicalEquipmentImport(value) {
  if (value === null || value === undefined) return null;
  const parts = String(value)
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? JSON.stringify(parts) : null;
}

function buildFullName(row) {
  const parts = [pick(row, 'First Name'), pick(row, 'Middle'), pick(row, 'Last Name')]
    .filter((p) => p !== null && p !== undefined && String(p).trim() !== '');
  return parts.join(' ');
}

async function importContactsFromWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  const clientIndexRows = sheetToRows(workbook, 'Client Index (A-Z)');
  const addressRows = sheetToRows(workbook, 'Address');
  const dietaryRows = sheetToRows(workbook, 'Dietary & Special Needs');
  const consentRows = sheetToRows(workbook, 'Consents');
  const emergencyRows = sheetToRows(workbook, 'Emergency Contact');

  const addressByName = new Map(
    addressRows.map((r) => [normalizeName(pick(r, 'Legal Full Name')), r])
  );
  const dietaryByName = new Map(
    dietaryRows.map((r) => [normalizeName(pick(r, 'Legal Full Name')), r])
  );
  const consentByName = new Map(
    consentRows.map((r) => [normalizeName(pick(r, 'Legal Full Name')), r])
  );
  const emergencyByName = new Map();
  for (const r of emergencyRows) {
    const key = normalizeName(pick(r, 'Legal Full Name'));
    if (!emergencyByName.has(key)) emergencyByName.set(key, []);
    emergencyByName.get(key).push(r);
  }

  let created = 0;
  let updated = 0;
  const errors = [];
  const usedAddressKeys = new Set();
  const usedDietaryKeys = new Set();

  for (const row of clientIndexRows) {
    const builtFullName = buildFullName(row);
    if (!builtFullName) continue;

    const key = normalizeName(builtFullName);

    try {
      const addressRow = addressByName.get(key) || {};
      const dietaryRow = dietaryByName.get(key) || {};
      const consentRow = consentByName.get(key) || {};
      const emergencyContactRows = emergencyByName.get(key) || [];

      if (addressByName.has(key)) usedAddressKeys.add(key);
      if (dietaryByName.has(key)) usedDietaryKeys.add(key);

      const existingResult = await pool.query(
        `SELECT id FROM contacts WHERE legal_full_name = $1`,
        [builtFullName]
      );
      const existed = existingResult.rows.length > 0;

      // Upsert the contact by legal_full_name. `source`/`unsubscribe_token`
      // are only set on insert (via the DO NOTHING-style exclusion below,
      // achieved by listing them only in the INSERT column list, not SET).
      const upsertResult = await pool.query(
        `
        INSERT INTO contacts (
          first_name, last_name, middle_name, legal_full_name, email, phone,
          client_status, assigned_agent, household_id, notes,
          gender, nationality, address_line1, city, region, country, postal_code,
          data_consent, passport_storage_consent, marketing_consent, consent_date_signed,
          source, unsubscribe_token
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'import',$22)
        ON CONFLICT (legal_full_name) DO UPDATE SET
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          middle_name = EXCLUDED.middle_name,
          email = EXCLUDED.email,
          phone = EXCLUDED.phone,
          client_status = EXCLUDED.client_status,
          assigned_agent = EXCLUDED.assigned_agent,
          household_id = EXCLUDED.household_id,
          notes = EXCLUDED.notes,
          gender = EXCLUDED.gender,
          nationality = EXCLUDED.nationality,
          address_line1 = EXCLUDED.address_line1,
          city = EXCLUDED.city,
          region = EXCLUDED.region,
          country = EXCLUDED.country,
          postal_code = EXCLUDED.postal_code,
          data_consent = EXCLUDED.data_consent,
          passport_storage_consent = EXCLUDED.passport_storage_consent,
          marketing_consent = EXCLUDED.marketing_consent,
          consent_date_signed = EXCLUDED.consent_date_signed
        RETURNING id
        `,
        [
          pick(row, 'First Name') || '',
          pick(row, 'Last Name') || '',
          pick(row, 'Middle') || null,
          builtFullName,
          pick(row, 'Email'),
          pick(row, 'Cell Phone'),
          pick(row, 'Client Status'),
          pick(row, 'Assigned Agent'),
          pick(row, 'Household ID'),
          pick(row, 'Notes'),
          pick(addressRow, 'Gender'),
          pick(addressRow, 'Nationality'),
          pick(addressRow, 'Street Address'),
          pick(addressRow, 'City'),
          pick(addressRow, 'State/Province'),
          pick(addressRow, 'Country'),
          pick(addressRow, 'PC/ZIP'),
          parseBoolean(pick(consentRow, 'Data Consent')) || false,
          parseBoolean(pick(consentRow, 'Passport Storage Consent')) || false,
          parseBoolean(pick(consentRow, 'Marketing Consent')) || false,
          pick(consentRow, 'Date Signed') || null,
          crypto.randomUUID(),
        ]
      );
      const contactId = upsertResult.rows[0].id;

      // --- Dietary & special needs (encrypted, detailed) ---
      const dietaryRestrictionsEnc = encryptField(pick(dietaryRow, 'Dietary Restrictions'));
      const foodAllergiesEnc = encryptField(pick(dietaryRow, 'Food Allergies'));
      const mobilityAssistanceEnc = encryptField(pick(dietaryRow, 'Mobility Assistance'));
      // Medical Equipment is stored as a chip array (single or multiple
      // values), not a raw string — see parseMedicalEquipmentImport above.
      const medicalEquipmentEnc = encryptField(parseMedicalEquipmentImport(pick(dietaryRow, 'Medical Equipment')));
      const otherNotesEnc = encryptField(pick(dietaryRow, 'Other Notes'));
      const hasDietaryData = [dietaryRestrictionsEnc, foodAllergiesEnc, mobilityAssistanceEnc, medicalEquipmentEnc, otherNotesEnc]
        .some((v) => v !== null && v !== undefined);

      if (hasDietaryData) {
        await pool.query(
          `
          INSERT INTO dietary_special_needs (contact_id, dietary_restrictions_enc, food_allergies_enc, mobility_assistance_enc, medical_equipment_enc, other_notes_enc)
          VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (contact_id) DO UPDATE SET
            dietary_restrictions_enc = EXCLUDED.dietary_restrictions_enc,
            food_allergies_enc = EXCLUDED.food_allergies_enc,
            mobility_assistance_enc = EXCLUDED.mobility_assistance_enc,
            medical_equipment_enc = EXCLUDED.medical_equipment_enc,
            other_notes_enc = EXCLUDED.other_notes_enc
          `,
          [contactId, dietaryRestrictionsEnc, foodAllergiesEnc, mobilityAssistanceEnc, medicalEquipmentEnc, otherNotesEnc]
        );
      }

      // --- Emergency contacts: replace with the current sheet's rows ---
      await pool.query(`DELETE FROM emergency_contacts WHERE contact_id = $1`, [contactId]);
      for (const ec of emergencyContactRows) {
        const name = pick(ec, 'Emergency Contact Name');
        if (!name) continue;
        await pool.query(
          `INSERT INTO emergency_contacts (contact_id, name, relationship, phone, email) VALUES ($1,$2,$3,$4,$5)`,
          [contactId, name, pick(ec, 'Relationship'), pick(ec, 'Phone Number'), pick(ec, 'Email Address')]
        );
      }

      if (existed) updated++;
      else created++;
    } catch (rowErr) {
      errors.push({ legalFullName: builtFullName, error: rowErr.message });
    }
  }

  const unmatchedAddressRows = [...addressByName.keys()]
    .filter((k) => !usedAddressKeys.has(k))
    .map((k) => pick(addressByName.get(k), 'Legal Full Name'));
  const unmatchedDietaryRows = [...dietaryByName.keys()]
    .filter((k) => !usedDietaryKeys.has(k))
    .map((k) => pick(dietaryByName.get(k), 'Legal Full Name'));

  return {
    created,
    updated,
    totalRows: clientIndexRows.length,
    errors,
    unmatchedAddressRows,
    unmatchedDietaryRows,
  };
}

module.exports = { importContactsFromWorkbook };