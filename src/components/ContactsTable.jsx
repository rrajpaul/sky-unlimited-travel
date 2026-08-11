import { useEffect, useState, useCallback } from 'react';
import { contactsApi } from '../api/crmApi';
import ContactForm from './ContactForm';
import ImportContactsModal from './ImportContactsModal';

export default function ContactsTable() {
  const [contacts, setContacts] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [editingContact, setEditingContact] = useState(null); // null = closed, {} = new, {...} = edit
  const [showImport, setShowImport] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revealFor, setRevealFor] = useState(null); // contact id currently prompting for password
  const [revealPassword, setRevealPassword] = useState('');
  const [revealError, setRevealError] = useState(null);
  const [revealedData, setRevealedData] = useState({}); // { [contactId]: { passport, dietarySpecialNeeds } }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await contactsApi.list({ search, page, pageSize });
      setContacts(res.contacts);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (data) => {
    if (editingContact?.id) {
      await contactsApi.update(editingContact.id, data);
    } else {
      await contactsApi.create(data);
    }
    setEditingContact(null);
    await load();
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this contact? This cannot be undone.')) return;
    await contactsApi.remove(id);
    await load();
  };

  const handleReveal = async (id) => {
    setRevealError(null);
    try {
      const data = await contactsApi.revealSensitive(id, revealPassword);
      setRevealedData((prev) => ({ ...prev, [id]: data }));
      setRevealFor(null);
      setRevealPassword('');
    } catch (err) {
      setRevealError(err.message);
    }
  };

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <input
          className="w-full sm:w-64 rounded-md border border-slate-300 px-3 py-2 text-sm"
          placeholder="Search name, email, company…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          type="search"
          name="contacts-table-search"
          id="contacts-table-search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
          data-lpignore="true"
          data-1p-ignore
        />
        <div className="flex gap-2 justify-end">
          <button onClick={() => setShowImport(true)} className="px-3 py-2 text-sm rounded-md border border-slate-300 text-slate-700">
            Import CSV/Excel
          </button>
          <button onClick={() => setEditingContact({})} className="px-3 py-2 text-sm rounded-md bg-slate-900 text-white">
            + Add contact
          </button>
        </div>
      </div>

      <p className="text-sm text-slate-500">{total} contacts</p>

      {/* Mobile: stacked cards (legal full name / email / actions) */}
      <div className="md:hidden border border-slate-200 rounded-lg divide-y divide-slate-100">
        {loading && (
          <div className="px-4 py-6 text-center text-slate-400 text-sm">Loading…</div>
        )}
        {!loading && contacts.length === 0 && (
          <div className="px-4 py-6 text-center text-slate-400 text-sm">No contacts yet.</div>
        )}
        {contacts.map((c) => (
          <div key={c.id} className="px-4 py-3 space-y-1">
            <div className="font-medium text-slate-900">
              {c.legal_full_name || `${c.first_name || ''} ${c.last_name || ''}`.trim()}
            </div>
            <div className="text-sm text-slate-600">{c.email}</div>
            <div className="flex gap-4 pt-1">
              <button onClick={() => setEditingContact(c)} className="text-sm text-slate-500 hover:text-slate-900">
                Edit
              </button>
              <button onClick={() => handleDelete(c.id)} className="text-sm text-red-500 hover:text-red-700">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop / tablet: full data table */}
      <div className="hidden md:block border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Phone</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Tags / Flags</th>
              <th className="px-4 py-2">Sensitive</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">Loading…</td></tr>
            )}
            {!loading && contacts.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No contacts yet.</td></tr>
            )}
            {contacts.map((c) => (
              <tr key={c.id} className="border-t border-slate-100 align-top">
                <td className="px-4 py-2 font-medium text-slate-900">
                  {c.first_name} {c.last_name}
                  {c.legal_full_name && (
                    <div className="text-xs text-slate-400 font-normal">{c.legal_full_name}</div>
                  )}
                </td>
                <td className="px-4 py-2 text-slate-600">{c.email}</td>
                <td className="px-4 py-2 text-slate-600">{c.phone}</td>
                <td className="px-4 py-2 text-slate-600">{c.client_status || '—'}</td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-1">
                    {(c.tags || []).map((t) => (
                      <span key={t} className="px-2 py-0.5 rounded-full bg-slate-100 text-xs text-slate-600">{t}</span>
                    ))}
                    {c.do_not_email && <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-xs">No email</span>}
                    {c.do_not_phone && <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 text-xs">No call</span>}
                  </div>
                </td>
                <td className="px-4 py-2">
                  {c.hasDietaryData ? (
                    revealedData[c.id] ? (
                      <div className="text-xs text-slate-700 space-y-0.5">
                        {revealedData[c.id].dietarySpecialNeeds?.dietaryRestrictions && (
                          <div>Dietary: {revealedData[c.id].dietarySpecialNeeds.dietaryRestrictions}</div>
                        )}
                        {revealedData[c.id].dietarySpecialNeeds?.foodAllergies && (
                          <div>Allergies: {revealedData[c.id].dietarySpecialNeeds.foodAllergies}</div>
                        )}
                        {revealedData[c.id].dietarySpecialNeeds?.mobilityAssistance && (
                          <div>Mobility: {revealedData[c.id].dietarySpecialNeeds.mobilityAssistance}</div>
                        )}
                        {(revealedData[c.id].dietarySpecialNeeds?.accessibilityNeeds || []).length > 0 && (
                          <div>Accessibility: {[].concat(revealedData[c.id].dietarySpecialNeeds.accessibilityNeeds).join(', ')}</div>
                        )}
                        {revealedData[c.id].dietarySpecialNeeds?.medicalEquipment && (
                          <div>Medical equip.: {revealedData[c.id].dietarySpecialNeeds.medicalEquipment}</div>
                        )}
                        {(revealedData[c.id].dietarySpecialNeeds?.medicalEquipmentNeeds || []).length > 0 && (
                          <div>Medical equip. (added): {[].concat(revealedData[c.id].dietarySpecialNeeds.medicalEquipmentNeeds).join(', ')}</div>
                        )}
                        {revealedData[c.id].dietarySpecialNeeds?.otherNotes && (
                          <div>Notes: {revealedData[c.id].dietarySpecialNeeds.otherNotes}</div>
                        )}
                      </div>
                    ) : revealFor === c.id ? (
                      <div className="flex flex-col gap-1">
                        <input
                          type="password"
                          autoFocus
                          className="w-32 rounded border border-slate-300 px-2 py-1 text-xs"
                          placeholder="Your password"
                          value={revealPassword}
                          onChange={(e) => setRevealPassword(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleReveal(c.id)}
                          name={`reveal-password-${c.id}`}
                          autoComplete="off"
                          data-lpignore="true"
                          data-1p-ignore
                        />
                        <div className="flex gap-1">
                          <button onClick={() => handleReveal(c.id)} className="text-xs px-2 py-1 rounded bg-slate-900 text-white">
                            Confirm
                          </button>
                          <button onClick={() => { setRevealFor(null); setRevealError(null); }} className="text-xs px-2 py-1 rounded border border-slate-300">
                            Cancel
                          </button>
                        </div>
                        {revealError && <span className="text-xs text-red-600">{revealError}</span>}
                      </div>
                    ) : (
                      <button
                        onClick={() => { setRevealFor(c.id); setRevealPassword(''); setRevealError(null); }}
                        className="text-xs text-slate-500 hover:text-slate-900 underline"
                      >
                        Sensitive info — reveal
                      </button>
                    )
                  ) : (
                    <span className="text-xs text-slate-300">—</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap sticky right-0 bg-white">
                  <button onClick={() => setEditingContact(c)} className="text-slate-500 hover:text-slate-900 mr-3">Edit</button>
                  <button onClick={() => handleDelete(c.id)} className="text-red-500 hover:text-red-700">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <button
            onClick={() => setPage((p) => Math.max(p - 1, 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 rounded-md border border-slate-300 disabled:opacity-40"
          >
            Previous
          </button>
          <span>Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 rounded-md border border-slate-300 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      {editingContact !== null && (
        <ContactForm
          contact={editingContact.id ? editingContact : null}
          onSave={handleSave}
          onCancel={() => setEditingContact(null)}
        />
      )}

      {showImport && (
        <ImportContactsModal onClose={() => setShowImport(false)} onImported={load} />
      )}
    </div>
  );
}