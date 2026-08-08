import { useState } from 'react';
import { contactsApi } from '../api/crmApi';

const EMPTY = {
  first_name: '', last_name: '', middle_name: '', legal_full_name: '',
  email: '', phone: '', company: '',
  address_line1: '', address_line2: '', city: '', region: '', postal_code: '', country: '',
  tags: '', notes: '', do_not_email: false, do_not_phone: false,
  dietary_restrictions: [], accessibility_needs: [], medical_equipment_needs: [],
  food_allergies: '', mobility_assistance: '', medical_equipment: '',
  special_requirements_notes: '',
};

const COMMON_DIETARY = ['Gluten-free', 'Peanut allergy', 'Tree nut allergy', 'Shellfish allergy', 'Dairy-free', 'Vegetarian', 'Vegan', 'Halal', 'Kosher'];
const COMMON_ACCESSIBILITY = ['Wheelchair access', 'Mobility assistance', 'Visual impairment', 'Hearing impairment', 'Service animal'];
const COMMON_MEDICAL_EQUIPMENT = ['CPAP machine', 'Oxygen tank', 'Insulin pump', 'Nebulizer', 'Walker', 'Feeding tube', 'Other medical device'];

export default function ContactForm({ contact, onSave, onCancel }) {
  const isNewContact = !contact?.id;
  const hasSensitiveData = !!contact?.hasDietaryData;

  const [form, setForm] = useState(
    contact
      ? { ...EMPTY, ...contact, tags: (contact.tags || []).join(', ') }
      : EMPTY
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Sensitive section (dietary/accessibility/medical) only stays locked
  // behind a password re-check when this contact actually HAS something
  // stored there — no point gating an empty section. There's nothing to
  // protect on a brand-new contact either, so both skip straight to
  // editable. Passport data is not stored anywhere in this app.
  const [revealed, setRevealed] = useState(isNewContact || !hasSensitiveData);
  const [revealing, setRevealing] = useState(false);
  const [revealPassword, setRevealPassword] = useState('');
  const [revealError, setRevealError] = useState(null);
  const [revealLoading, setRevealLoading] = useState(false);

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

  const handleRevealConfirm = async () => {
    setRevealError(null);
    setRevealLoading(true);
    try {
      const data = await contactsApi.revealSensitive(contact.id, revealPassword);
      const d = data.dietarySpecialNeeds;
      setForm((f) => ({
        ...f,
        dietary_restrictions: [].concat(d?.dietaryRestrictions || []).filter(Boolean),
        accessibility_needs: [].concat(d?.accessibilityNeeds || []).filter(Boolean),
        medical_equipment_needs: [].concat(d?.medicalEquipmentNeeds || []).filter(Boolean),
        food_allergies: d?.foodAllergies || '',
        mobility_assistance: d?.mobilityAssistance || '',
        medical_equipment: d?.medicalEquipment || '',
        special_requirements_notes: d?.otherNotes || '',
      }));
      setRevealed(true);
      setRevealing(false);
      setRevealPassword('');
    } catch (err) {
      setRevealError(err.message);
    } finally {
      setRevealLoading(false);
    }
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

        {/* --- Section 1: contact info --- */}

        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" value={form.first_name} onChange={update('first_name')} />
          <Field label="Last name" value={form.last_name} onChange={update('last_name')} />
        </div>
        <Field label="Middle name" value={form.middle_name} onChange={update('middle_name')} />
        <label className="block text-sm font-medium text-slate-700">
          Legal full name
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={form.legal_full_name}
            onChange={update('legal_full_name')}
          />
          <span className="mt-1 block text-xs text-slate-400">
            Must match a client-profile import exactly to link future re-imports to this
            contact — changing it may cause a re-import to create a duplicate instead of
            updating this record.
          </span>
        </label>

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

        {/* --- Section 2: sensitive information --- */}

        <div className="border-t pt-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-2">Sensitive information</h3>

          {!revealed ? (
            <div className="bg-slate-50 rounded-md p-3">
              <p className="text-xs text-slate-500 mb-2">
                Dietary, accessibility, and medical details are encrypted. Enter your
                password to view and edit them for this contact.
              </p>
              {!revealing ? (
                <button
                  type="button"
                  onClick={() => { setRevealing(true); setRevealError(null); }}
                  className="text-xs px-2 py-1 rounded bg-slate-900 text-white"
                >
                  Show sensitive information
                </button>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <input
                    type="password"
                    autoFocus
                    className="w-48 rounded border border-slate-300 px-2 py-1 text-xs"
                    placeholder="Your password"
                    value={revealPassword}
                    onChange={(e) => setRevealPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleRevealConfirm()}
                    name="reveal-password-form"
                    autoComplete="off"
                    data-lpignore="true"
                    data-1p-ignore
                  />
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={handleRevealConfirm}
                      disabled={revealLoading || !revealPassword}
                      className="text-xs px-2 py-1 rounded bg-slate-900 text-white disabled:opacity-50"
                    >
                      {revealLoading ? 'Checking…' : 'Confirm'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setRevealing(false); setRevealPassword(''); setRevealError(null); }}
                      className="text-xs px-2 py-1 rounded border border-slate-300"
                    >
                      Cancel
                    </button>
                  </div>
                  {revealError && <span className="text-xs text-red-600">{revealError}</span>}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <ChipPicker
                label="Dietary restrictions / allergies"
                options={COMMON_DIETARY}
                selected={form.dietary_restrictions}
                onToggle={(opt) => toggleChip('dietary_restrictions', opt)()}
                extra={form.dietary_restrictions.filter((v) => !COMMON_DIETARY.includes(v))}
                onRemoveExtra={(val) => toggleChip('dietary_restrictions', val)()}
              />
              <Field
                label="Food allergies (free text, e.g. from import)"
                value={form.food_allergies}
                onChange={update('food_allergies')}
                placeholder="e.g. severe shellfish allergy"
              />

              <ChipPicker
                label="Accessibility needs"
                options={COMMON_ACCESSIBILITY}
                selected={form.accessibility_needs}
                onToggle={(opt) => toggleChip('accessibility_needs', opt)()}
                extra={form.accessibility_needs.filter((v) => !COMMON_ACCESSIBILITY.includes(v))}
                onRemoveExtra={(val) => toggleChip('accessibility_needs', val)()}
              />
              <Field
                label="Mobility assistance (free text, e.g. from import)"
                value={form.mobility_assistance}
                onChange={update('mobility_assistance')}
                placeholder="e.g. WHEELCHAIR"
              />

              <ChipPicker
                label="Medical equipment"
                options={COMMON_MEDICAL_EQUIPMENT}
                selected={form.medical_equipment_needs}
                onToggle={(opt) => toggleChip('medical_equipment_needs', opt)()}
                extra={form.medical_equipment_needs.filter((v) => !COMMON_MEDICAL_EQUIPMENT.includes(v))}
                onRemoveExtra={(val) => toggleChip('medical_equipment_needs', val)()}
              />
              <Field
                label="Medical equipment (free text, e.g. from import)"
                value={form.medical_equipment}
                onChange={update('medical_equipment')}
                placeholder="e.g. CPAP machine, own oxygen tank"
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

              {!isNewContact && hasSensitiveData && (
                <p className="text-xs text-slate-400">
                  Editing any field here — chips or free text — overwrites only that field.
                  Values with a dashed amber border are free text from an Excel import that
                  didn't match a standard chip; click × to remove one.
                </p>
              )}
            </div>
          )}
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

function ChipPicker({ label, options, selected, onToggle, extra = [], onRemoveExtra }) {
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
        {extra.map((val) => (
          <span
            key={val}
            className="px-2.5 py-1 rounded-full text-xs border border-dashed border-amber-400 bg-amber-50 text-amber-800 flex items-center gap-1"
            title="From an Excel import — not one of the standard options"
          >
            {val}
            <button
              type="button"
              onClick={() => onRemoveExtra(val)}
              className="text-amber-500 hover:text-amber-800 leading-none"
              aria-label={`Remove ${val}`}
            >
              ×
            </button>
          </span>
        ))}
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