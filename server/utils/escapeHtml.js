// Location: server/utils/escapeHtml.js
//
// Escapes user-supplied values before they're interpolated into the HTML of
// an outbound email.
//
// Several routes build email bodies with template literals containing values
// that came straight from a PUBLIC form — a booking inquiry's name/details, a
// giveaway entrant's name. Without escaping, anyone can post markup that ends
// up rendered in an inbox: at best a broken-looking email, at worst an
// attacker-controlled link inside a message that genuinely came from your
// domain.
//
// Deliberately NOT applied to campaign html_body in routes/campaigns.js —
// that's admin-authored HTML and escaping it would render the markup as
// visible text instead of formatting the email.
function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')   // must run first, or it double-escapes the others
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { escapeHtml };