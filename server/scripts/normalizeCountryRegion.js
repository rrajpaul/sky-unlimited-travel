// server/scripts/normalizeCountryRegion.js
//
// One-off migration: normalizes existing contacts.country and
// contacts.region from the Excel-import abbreviations ("USA"/"CANADA",
// 2-letter state/province codes like "PA"/"ON") to the full names the
// ContactForm's Country/State-Province dropdowns now expect ("United
// States"/"Canada", "Pennsylvania"/"Ontario", etc.) — so existing
// contacts show up correctly selected in those dropdowns instead of
// appearing blank.
//
// Run manually from the server directory:
//   node scripts/normalizeCountryRegion.js
// (needs DATABASE_URL set in the environment, same as the app itself)
//
// Safe to re-run: every UPDATE only matches rows still in the OLD
// (abbreviated) form, so already-normalized rows are simply not matched
// a second time — running it twice in a row is a no-op the second time.
//
// Scope: touches ONLY contacts.country and contacts.region. Does not
// touch any other column, and does not touch dob_enc, dietary_special_needs,
// or any other encrypted/sensitive data.
//
// If your data has country/region values outside what's covered here
// (e.g. abbreviations for a country other than US/Canada, or state codes
// that don't match this list), those rows are simply left untouched —
// this script never guesses, it only maps exact known abbreviations.

const { pool } = require('../db');

const US_STATE_MAP = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  PR: 'Puerto Rico', GU: 'Guam', VI: 'U.S. Virgin Islands',
};

const CA_PROVINCE_MAP = {
  AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador', NT: 'Northwest Territories', NS: 'Nova Scotia',
  NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec',
  SK: 'Saskatchewan', YT: 'Yukon',
};

async function run() {
  const client = await pool.connect();
  try {
    // --- Country ---
    const usCountry = await client.query(
      `UPDATE contacts SET country = 'United States'
       WHERE TRIM(UPPER(country)) IN ('USA', 'US', 'U.S.', 'U.S.A.', 'UNITED STATES')
         AND country IS DISTINCT FROM 'United States'`
    );
    const caCountry = await client.query(
      `UPDATE contacts SET country = 'Canada'
       WHERE TRIM(UPPER(country)) IN ('CANADA', 'CAN', 'CA')
         AND country IS DISTINCT FROM 'Canada'`
    );
    console.log(`Country: ${usCountry.rowCount} row(s) -> 'United States', ${caCountry.rowCount} row(s) -> 'Canada'`);

    // --- Region (State/Province) — only touches rows whose country is
    // NOW exactly 'United States' or 'Canada' (after the update above),
    // so a 2-letter code that happens to coincide with something in a
    // different country is never touched. ---
    let usRegionCount = 0;
    for (const [code, name] of Object.entries(US_STATE_MAP)) {
      const res = await client.query(
        `UPDATE contacts SET region = $1
         WHERE country = 'United States' AND TRIM(UPPER(region)) = $2
           AND region IS DISTINCT FROM $1`,
        [name, code]
      );
      usRegionCount += res.rowCount;
    }

    let caRegionCount = 0;
    for (const [code, name] of Object.entries(CA_PROVINCE_MAP)) {
      const res = await client.query(
        `UPDATE contacts SET region = $1
         WHERE country = 'Canada' AND TRIM(UPPER(region)) = $2
           AND region IS DISTINCT FROM $1`,
        [name, code]
      );
      caRegionCount += res.rowCount;
    }
    console.log(`Region: ${usRegionCount} US state code(s) normalized, ${caRegionCount} CA province code(s) normalized`);

    console.log('Done.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('normalizeCountryRegion.js failed:', err);
  process.exitCode = 1;
});