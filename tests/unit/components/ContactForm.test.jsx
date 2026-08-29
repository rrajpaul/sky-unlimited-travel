// Location: tests/unit/components/ContactForm.test.jsx
//
// ContactForm's interesting behavior isn't the fields — it's the rules
// around them:
//   - when the encrypted "Sensitive information" section is gated behind a
//     password vs. open immediately
//   - what the save payload contains in each of those states (omitting a key
//     vs. sending it empty means very different things to the backend)
//   - the reauthPassword that a successful reveal caches so Save doesn't
//     prompt twice
//   - State/Province switching between a dropdown and free text by country
//
// The only mocked module is the CRM API client; everything else is the real
// component.
import React from 'react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/api/crmApi', () => ({
  contactsApi: { revealSensitive: vi.fn() },
}));

import { contactsApi } from '@/api/crmApi';
import ContactForm from '@/components/ContactForm';

// A saved contact with encrypted data behind the gate. Note the API returns
// hasDob / hasDietaryData flags rather than the values themselves.
const GATED_CONTACT = {
  id: 7,
  first_name: 'Jane',
  last_name: 'Doe',
  email: 'jane@example.com',
  tags: ['vip', 'honeymoon-2026'],
  hasDob: true,
  hasDietaryData: true,
};

const REVEALED_PAYLOAD = {
  dob: '1990-04-12',
  dietarySpecialNeeds: {
    dietaryRestrictions: ['Vegan', 'Pescatarian-ish'], // second is non-standard
    accessibilityNeeds: ['Wheelchair access'],
    foodAllergies: ['Peanut'],
    mobilityAssistance: [],
    medicalEquipment: ['CPAP machine'],
    otherNotes: 'Needs aisle seat',
  },
};

let onSave;
let onCancel;

beforeEach(() => {
  onSave = vi.fn().mockResolvedValue();
  onCancel = vi.fn();
  contactsApi.revealSensitive.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const save = (user) => user.click(screen.getByRole('button', { name: /save contact/i }));

describe('ContactForm — sensitive section gating', () => {
  test('a brand-new contact skips the gate entirely', () => {
    render(<ContactForm onSave={onSave} onCancel={onCancel} />);

    expect(screen.getByRole('heading', { name: /add contact/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Date of birth')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show sensitive information/i })).not.toBeInTheDocument();
  });

  test('an existing contact with no stored sensitive data skips the gate', () => {
    render(
      <ContactForm
        contact={{ id: 3, first_name: 'Bob', hasDob: false, hasDietaryData: false }}
        onSave={onSave}
        onCancel={onCancel}
      />
    );

    expect(screen.getByLabelText('Date of birth')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show sensitive information/i })).not.toBeInTheDocument();
  });

  test('an existing contact WITH stored sensitive data is gated', () => {
    render(<ContactForm contact={GATED_CONTACT} onSave={onSave} onCancel={onCancel} />);

    expect(screen.getByRole('heading', { name: /edit contact/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show sensitive information/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Date of birth')).not.toBeInTheDocument();
  });

  test('gating triggers on either flag alone', () => {
    const { unmount } = render(
      <ContactForm contact={{ id: 1, hasDob: true }} onSave={onSave} onCancel={onCancel} />
    );
    expect(screen.getByRole('button', { name: /show sensitive information/i })).toBeInTheDocument();
    unmount();

    render(<ContactForm contact={{ id: 2, hasDietaryData: true }} onSave={onSave} onCancel={onCancel} />);
    expect(screen.getByRole('button', { name: /show sensitive information/i })).toBeInTheDocument();
  });
});

describe('ContactForm — revealing sensitive data', () => {
  test('sends the contact id and password, then populates the fields', async () => {
    const user = userEvent.setup();
    contactsApi.revealSensitive.mockResolvedValue(REVEALED_PAYLOAD);

    render(<ContactForm contact={GATED_CONTACT} onSave={onSave} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: /show sensitive information/i }));
    await user.type(screen.getByPlaceholderText(/your password/i), 'hunter2');
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => {
      expect(contactsApi.revealSensitive).toHaveBeenCalledWith(7, 'hunter2');
    });

    expect(await screen.findByLabelText('Date of birth')).toHaveValue('1990-04-12');
    expect(screen.getByPlaceholderText(/severe nut allergy/i)).toHaveValue('Needs aisle seat');
  });

  test('the Confirm button stays disabled until a password is typed', async () => {
    const user = userEvent.setup();
    render(<ContactForm contact={GATED_CONTACT} onSave={onSave} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: /show sensitive information/i }));
    expect(screen.getByRole('button', { name: /^confirm$/i })).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/your password/i), 'x');
    expect(screen.getByRole('button', { name: /^confirm$/i })).toBeEnabled();
  });

  test('a wrong password shows the error and leaves the section locked', async () => {
    const user = userEvent.setup();
    contactsApi.revealSensitive.mockRejectedValue(new Error('Incorrect password'));

    render(<ContactForm contact={GATED_CONTACT} onSave={onSave} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: /show sensitive information/i }));
    await user.type(screen.getByPlaceholderText(/your password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    expect(await screen.findByText('Incorrect password')).toBeInTheDocument();
    expect(screen.queryByLabelText('Date of birth')).not.toBeInTheDocument();
  });

  test('pressing Enter in the password field submits the reveal', async () => {
    const user = userEvent.setup();
    contactsApi.revealSensitive.mockResolvedValue(REVEALED_PAYLOAD);

    render(<ContactForm contact={GATED_CONTACT} onSave={onSave} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: /show sensitive information/i }));
    await user.type(screen.getByPlaceholderText(/your password/i), 'hunter2{Enter}');

    await waitFor(() => expect(contactsApi.revealSensitive).toHaveBeenCalled());
    expect(await screen.findByLabelText('Date of birth')).toHaveValue('1990-04-12');
  });

  test('cancelling the reveal clears the typed password and any error', async () => {
    const user = userEvent.setup();
    contactsApi.revealSensitive.mockRejectedValue(new Error('Incorrect password'));

    render(<ContactForm contact={GATED_CONTACT} onSave={onSave} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: /show sensitive information/i }));
    await user.type(screen.getByPlaceholderText(/your password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));
    await screen.findByText('Incorrect password');

    // The reveal panel's own Cancel, not the form's.
    const revealCancel = screen
      .getAllByRole('button', { name: /^cancel$/i })
      .find((b) => b.className.includes('text-xs'));
    await user.click(revealCancel);

    expect(screen.queryByText('Incorrect password')).not.toBeInTheDocument();
    // Re-opening starts from an empty field.
    await user.click(screen.getByRole('button', { name: /show sensitive information/i }));
    expect(screen.getByPlaceholderText(/your password/i)).toHaveValue('');
  });
});

describe('ContactForm — save payload', () => {
  test('omits sensitive keys entirely when the section was never revealed', async () => {
    const user = userEvent.setup();
    render(<ContactForm contact={GATED_CONTACT} onSave={onSave} onCancel={onCancel} />);

    await save(user);

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const payload = onSave.mock.calls[0][0];

    // "key absent" tells the backend to leave the encrypted data alone —
    // sending an empty value would wipe it instead.
    for (const key of [
      'dob',
      'dietary_restrictions',
      'accessibility_needs',
      'food_allergies',
      'mobility_assistance',
      'medical_equipment',
      'special_requirements_notes',
    ]) {
      expect(payload).not.toHaveProperty(key);
    }
    expect(payload).not.toHaveProperty('reauthPassword');
    expect(payload.first_name).toBe('Jane');
  });

  test('includes sensitive values and the cached reauthPassword after a reveal', async () => {
    const user = userEvent.setup();
    contactsApi.revealSensitive.mockResolvedValue(REVEALED_PAYLOAD);

    render(<ContactForm contact={GATED_CONTACT} onSave={onSave} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: /show sensitive information/i }));
    await user.type(screen.getByPlaceholderText(/your password/i), 'hunter2');
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));
    await screen.findByLabelText('Date of birth');

    await save(user);

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const payload = onSave.mock.calls[0][0];

    // Reusing the reveal password is what stops Save prompting a second time.
    expect(payload.reauthPassword).toBe('hunter2');
    expect(payload.dob).toBe('1990-04-12');
    expect(payload.food_allergies).toEqual(['Peanut']);
    expect(payload.special_requirements_notes).toBe('Needs aisle seat');
  });

  test('a new contact sends sensitive keys but no reauthPassword', async () => {
    const user = userEvent.setup();
    render(<ContactForm onSave={onSave} onCancel={onCancel} />);

    await user.type(screen.getByLabelText('First name'), 'New');
    await save(user);

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const payload = onSave.mock.calls[0][0];

    expect(payload).toHaveProperty('dob');
    expect(payload).not.toHaveProperty('reauthPassword');
    expect(payload.first_name).toBe('New');
  });

  test('splits the tags string into a trimmed array', async () => {
    const user = userEvent.setup();
    render(<ContactForm onSave={onSave} onCancel={onCancel} />);

    await user.type(screen.getByLabelText(/tags/i), ' vip ,  honeymoon-2026 , , ');
    await save(user);

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].tags).toEqual(['vip', 'honeymoon-2026']);
  });

  test('joins an existing tags array back into the input', () => {
    render(<ContactForm contact={GATED_CONTACT} onSave={onSave} onCancel={onCancel} />);
    expect(screen.getByLabelText(/tags/i)).toHaveValue('vip, honeymoon-2026');
  });

  test('surfaces a save failure instead of failing silently', async () => {
    const user = userEvent.setup();
    onSave.mockRejectedValue(new Error('Email already in use'));

    render(<ContactForm onSave={onSave} onCancel={onCancel} />);
    await save(user);

    expect(await screen.findByText('Email already in use')).toBeInTheDocument();
    // The button must return to enabled so the admin can retry.
    expect(screen.getByRole('button', { name: /save contact/i })).toBeEnabled();
  });

  test('Cancel calls onCancel without saving', async () => {
    const user = userEvent.setup();
    render(<ContactForm onSave={onSave} onCancel={onCancel} />);

    const formCancel = screen
      .getAllByRole('button', { name: /^cancel$/i })
      .find((b) => b.className.includes('px-4'));
    await user.click(formCancel);

    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('ContactForm — country / region field', () => {
  test('State / Province is free text for a country without a fixed list', () => {
    render(<ContactForm onSave={onSave} onCancel={onCancel} />);
    expect(screen.getByLabelText('State / Province').tagName).toBe('INPUT');
  });

  test('switches to a dropdown of states for the United States', async () => {
    const user = userEvent.setup();
    render(<ContactForm onSave={onSave} onCancel={onCancel} />);

    await user.selectOptions(screen.getByLabelText('Country'), 'United States');

    const region = screen.getByLabelText('State / Province');
    expect(region.tagName).toBe('SELECT');
    expect(within(region).getByRole('option', { name: 'California' })).toBeInTheDocument();
    expect(within(region).queryByRole('option', { name: 'Ontario' })).not.toBeInTheDocument();
  });

  test('switches to a dropdown of provinces for Canada', async () => {
    const user = userEvent.setup();
    render(<ContactForm onSave={onSave} onCancel={onCancel} />);

    await user.selectOptions(screen.getByLabelText('Country'), 'Canada');

    const region = screen.getByLabelText('State / Province');
    expect(region.tagName).toBe('SELECT');
    expect(within(region).getByRole('option', { name: 'Ontario' })).toBeInTheDocument();
    expect(within(region).queryByRole('option', { name: 'California' })).not.toBeInTheDocument();
  });

  test('reverts to free text when switching to another country', async () => {
    const user = userEvent.setup();
    render(<ContactForm onSave={onSave} onCancel={onCancel} />);

    await user.selectOptions(screen.getByLabelText('Country'), 'Canada');
    expect(screen.getByLabelText('State / Province').tagName).toBe('SELECT');

    await user.selectOptions(screen.getByLabelText('Country'), 'France');
    expect(screen.getByLabelText('State / Province').tagName).toBe('INPUT');
  });
});

describe('ContactForm — chips', () => {
  test('toggling a chip adds it to the payload, and toggling again removes it', async () => {
    const user = userEvent.setup();
    render(<ContactForm onSave={onSave} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: 'Vegan' }));
    await save(user);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].dietary_restrictions).toEqual(['Vegan']);

    await user.click(screen.getByRole('button', { name: 'Vegan' }));
    await save(user);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1][0].dietary_restrictions).toEqual([]);
  });

  test('shows imported free-text values as removable extra chips', async () => {
    const user = userEvent.setup();
    contactsApi.revealSensitive.mockResolvedValue(REVEALED_PAYLOAD);

    render(<ContactForm contact={GATED_CONTACT} onSave={onSave} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: /show sensitive information/i }));
    await user.type(screen.getByPlaceholderText(/your password/i), 'hunter2');
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    // "Pescatarian-ish" isn't one of the standard options, so it renders as
    // an extra chip with a remove control.
    const remove = await screen.findByRole('button', { name: 'Remove Pescatarian-ish' });
    expect(remove).toBeInTheDocument();

    await user.click(remove);
    await save(user);

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].dietary_restrictions).toEqual(['Vegan']);
  });

  test('a chip matching a revealed value starts selected', async () => {
    const user = userEvent.setup();
    contactsApi.revealSensitive.mockResolvedValue(REVEALED_PAYLOAD);

    render(<ContactForm contact={GATED_CONTACT} onSave={onSave} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: /show sensitive information/i }));
    await user.type(screen.getByPlaceholderText(/your password/i), 'hunter2');
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    const vegan = await screen.findByRole('button', { name: 'Vegan' });
    expect(vegan.className).toContain('bg-slate-900');

    const halal = screen.getByRole('button', { name: 'Halal' });
    expect(halal.className).not.toContain('bg-slate-900');
  });
});