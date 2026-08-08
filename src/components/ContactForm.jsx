import { useState } from 'react';

const EMPTY = {
  first_name: '', last_name: '', email: '', phone: '', company: '',
  address_line1: '', address_line2: '', city: '', region: '', postal_code: '', country: '',
  tags: '', notes: '', do_not_email: false, do_not_phone: false,
  dietary_restrictions: [], accessibility_needs: [], special_requirements_notes: '',
};

const COMMON_DIETARY = ['Gluten-free', 'Peanut allergy', 'Tree nut allergy', 'Shellfish allergy', 'Dairy-free', 'Vegetarian', 'Vegan', 'Halal', 'Kosher'];
const COMMON_ACCESSIBILITY = ['Wheelchair access', 'Mobility assistance', 'Visual impairment', 'Hearing impairment', 'Service animal'];

export default function ContactForm({ contact, onSave, onCancel }) {
  const [form, setForm] = useState(
    contact
      ? { ...EMPTY, ...contact, tags: (contact.tags || []).join(', ') }
      : EMPTY
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const update = (field) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [field]: value }));
  };

  const toggleChip = (field, option) => () => {
    setForm((f) => {
      const current = f[field] || [];
      const has = current.includes(option);
      return { ...f, [field]: has ? current.filter((v) => v !== option) : [...current, option] };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...form,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      };
      await onSave(payload);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-slate-900">{contact ? 'Edit contact' : 'Add contact'}</h2>

        {contact?.legal_full_name && (
          <div className="bg-slate-50 rounded-md px-3 py-2 text-xs text-slate-500">
            Legal name and passport data for this contact came from a client-profile import
            and aren't editable here. Use the "reveal" option in the table to view them, or
            re-import an updated file to change them.
          </div>
        )}

        {contact?.hasDietaryData && (
          <div className="bg-amber-50 rounded-md px-3 py-2 text-xs text-amber-700">
            Dietary/accessibility info below is encrypted and only visible via "reveal" in the
            table. If you haven't revealed it first, saving this form will overwrite whatever
            is currently stored with just what's selected below — check "reveal" before
            editing if you want to see the current values first.
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" value={form.first_name} onChange={update('first_name')} />
          <Field label="Last name" value={form.last_name} onChange={update('last_name')} />
        </div>

        <Field label="Email" type="email" value={form.email} onChange={update('email')} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone" value={form.phone} onChange={update('phone')} />
          <Field label="Company" value={form.company} onChange={update('company')} />
        </div>

        <Field label="Address line 1" value={form.address_line1} onChange={update('address_line1')} />
        <Field label="Address line 2 (apt, unit)" value={form.address_line2} onChange={update('address_line2')} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="City" value={form.city} onChange={update('city')} />
          <Field label="State / Province" value={form.region} onChange={update('region')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Postal / ZIP code" value={form.postal_code} onChange={update('postal_code')} />
          <Field label="Country" value={form.country} onChange={update('country')} />
        </div>
        <Field label="Tags (comma separated)" value={form.tags} onChange={update('tags')} placeholder="vip, honeymoon-2026" />

        <div className="border-t pt-4">
          <ChipPicker
            label="Dietary restrictions / allergies"
            options={COMMON_DIETARY}
            selected={form.dietary_restrictions}
            onToggle={(opt) => toggleChip('dietary_restrictions', opt)()}
          />
        </div>

        <ChipPicker
          label="Accessibility needs"
          options={COMMON_ACCESSIBILITY}
          selected={form.accessibility_needs}
          onToggle={(opt) => toggleChip('accessibility_needs', opt)()}
        />

        <label className="block text-sm font-medium text-slate-700">
          Special requirements notes
          <textarea
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            rows={2}
            placeholder="e.g. severe nut allergy — carries EpiPen; needs aisle seat"
            value={form.special_requirements_notes}
            onChange={update('special_requirements_notes')}
          />
        </label>

        <label className="block text-sm font-medium text-slate-700">
          Notes
          <textarea
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            rows={3}
            value={form.notes}
            onChange={update('notes')}
          />
        </label>

        <div className="flex gap-6 border-t pt-4">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.do_not_email} onChange={update('do_not_email')} />
            Do not email
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.do_not_phone} onChange={update('do_not_phone')} />
            Do not call
          </label>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm rounded-md border border-slate-300 text-slate-700">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-md bg-slate-900 text-white disabled:opacity-50">
            {saving ? 'Saving…' : 'Save contact'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ChipPicker({ label, options, selected, onToggle }) {
  return (
    <div>
      <p className="text-sm font-medium text-slate-700 mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = selected.includes(opt);
          return (
            <button
              type="button"
              key={opt}
              onClick={() => onToggle(opt)}
              className={`px-2.5 py-1 rounded-full text-xs border ${
                active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, ...props }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        {...props}
      />
    </label>
  );
}