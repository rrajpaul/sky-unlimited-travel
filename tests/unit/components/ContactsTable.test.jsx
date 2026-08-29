// Location: tests/unit/components/ContactsTable.test.jsx
//
// ContactsTable renders each contact TWICE — a mobile card stack and a
// desktop table, both always in the DOM with visibility handled by CSS
// (md:hidden / hidden md:block). jsdom doesn't apply media queries, so
// queries here use getAllBy* and count instances rather than assuming one.
//
// The behaviour worth testing is the wiring rather than the markup:
// what gets sent to the API on search/paginate, create vs update on save,
// the confirm() gate on delete, and the per-row password reveal.
//
// contactsApi is mocked; ContactForm and ImportContactsModal are replaced
// with minimal stand-ins so this stays a test of ContactsTable alone.
import React from 'react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/api/crmApi', () => ({
  contactsApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    revealSensitive: vi.fn(),
  },
}));

// Stand-in for ContactForm: exposes the contact it received plus buttons to
// trigger onSave/onCancel, so ContactsTable's own handlers can be tested
// without depending on the real form's internals.
//
// It reports `null` and `{}` distinctly on purpose. The real ContactForm
// branches on `contact ? 'Edit contact' : 'Add contact'`, so handing it `{}`
// for a new contact would title the form "Edit contact" — a stub that
// collapsed both to "new" would let that regression through.
vi.mock('@/components/ContactForm', () => ({
  default: ({ contact, onSave, onCancel }) => (
    <div data-testid="contact-form">
      <span data-testid="form-contact-arg">
        {contact === null ? 'null' : contact === undefined ? 'undefined' : `object:${contact.id ?? 'no-id'}`}
      </span>
      <button onClick={() => onSave({ first_name: 'Saved' })}>form-save</button>
      <button onClick={onCancel}>form-cancel</button>
    </div>
  ),
}));

vi.mock('@/components/ImportContactsModal', () => ({
  default: ({ onClose, onImported }) => (
    <div data-testid="import-modal">
      <button onClick={onClose}>import-close</button>
      <button onClick={onImported}>import-done</button>
    </div>
  ),
}));

import { contactsApi } from '@/api/crmApi';
import ContactsTable from '@/components/ContactsTable';

const CONTACT = {
  id: 1,
  first_name: 'Jane',
  last_name: 'Doe',
  legal_full_name: 'Jane Amelia Doe',
  email: 'jane@example.com',
  phone: '555-1234',
  client_status: 'VIP',
  tags: ['honeymoon'],
  do_not_email: true,
  do_not_phone: false,
  hasDob: true,
  hasDietaryData: true,
};

const PLAIN_CONTACT = {
  id: 2,
  first_name: 'Bob',
  last_name: 'Smith',
  email: 'bob@example.com',
  client_status: 'CLIENT',
  tags: [],
  hasDob: false,
  hasDietaryData: false,
};

const listResult = (contacts = [CONTACT], total = contacts.length) => ({ contacts, total });

// Waits past the initial load so assertions don't race the loading state.
const settled = () => screen.findAllByText(/contacts$/i);

beforeEach(() => {
  contactsApi.list.mockResolvedValue(listResult());
  contactsApi.create.mockResolvedValue({});
  contactsApi.update.mockResolvedValue({});
  contactsApi.remove.mockResolvedValue(null);
  contactsApi.revealSensitive.mockReset();
  vi.stubGlobal('confirm', vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('ContactsTable — loading and listing', () => {
  test('requests the first page on mount with the default page size', async () => {
    render(<ContactsTable />);

    await waitFor(() => {
      expect(contactsApi.list).toHaveBeenCalledWith({ search: '', page: 1, pageSize: 25 });
    });
  });

  test('shows a loading state, then the rows', async () => {
    let resolve;
    contactsApi.list.mockReturnValue(new Promise((r) => { resolve = r; }));

    render(<ContactsTable />);
    expect(screen.getAllByText('Loading…').length).toBeGreaterThan(0);

    resolve(listResult());
    expect(await screen.findAllByText('jane@example.com')).not.toHaveLength(0);
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  test('shows an empty state when there are no contacts', async () => {
    contactsApi.list.mockResolvedValue(listResult([], 0));

    render(<ContactsTable />);

    expect(await screen.findAllByText('No contacts yet.')).not.toHaveLength(0);
    expect(screen.getByText('0 contacts')).toBeInTheDocument();
  });

  test('reports the total from the server, not the page length', async () => {
    // 1 row on this page, 60 overall — the count must reflect the latter.
    contactsApi.list.mockResolvedValue(listResult([CONTACT], 60));

    render(<ContactsTable />);

    expect(await screen.findByText('60 contacts')).toBeInTheDocument();
  });

  test('renders contact details and flags', async () => {
    render(<ContactsTable />);
    await settled();

    expect(screen.getAllByText('jane@example.com').length).toBeGreaterThan(0);
    expect(screen.getByText('555-1234')).toBeInTheDocument();
    expect(screen.getByText('honeymoon')).toBeInTheDocument();
    // do_not_email is true, do_not_phone is false.
    expect(screen.getByText('No email')).toBeInTheDocument();
    expect(screen.queryByText('No call')).not.toBeInTheDocument();
  });
});

describe('ContactsTable — status formatting', () => {
  test('keeps VIP uppercase and title-cases other statuses', async () => {
    contactsApi.list.mockResolvedValue(listResult([CONTACT, PLAIN_CONTACT], 2));

    render(<ContactsTable />);
    await settled();

    expect(screen.getByText('VIP')).toBeInTheDocument();
    expect(screen.getByText('Client')).toBeInTheDocument();
  });

  test('renders a dash when there is no status', async () => {
    contactsApi.list.mockResolvedValue(listResult([{ ...PLAIN_CONTACT, client_status: null }], 1));

    render(<ContactsTable />);
    await settled();

    // A dash also appears in the Sensitive column for contacts with nothing
    // encrypted, so scope this to the Status cell (4th column) rather than
    // matching on the character alone.
    const row = screen.getByRole('row', { name: /bob smith/i });
    const statusCell = within(row).getAllByRole('cell')[3];
    expect(statusCell).toHaveTextContent('—');
  });
});

describe('ContactsTable — search', () => {
  test('passes the search term to the API', async () => {
    const user = userEvent.setup();
    render(<ContactsTable />);
    await settled();

    await user.type(screen.getByPlaceholderText(/search name, email, company/i), 'jane');

    await waitFor(() => {
      expect(contactsApi.list).toHaveBeenLastCalledWith({ search: 'jane', page: 1, pageSize: 25 });
    });
  });

  test('resets to page 1 when the search changes', async () => {
    const user = userEvent.setup();
    contactsApi.list.mockResolvedValue(listResult([CONTACT], 60));

    render(<ContactsTable />);
    await screen.findByText('Page 1 of 3');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Page 2 of 3');

    await user.type(screen.getByPlaceholderText(/search name, email, company/i), 'x');

    // Staying on page 2 while filtering would often show an empty result set.
    await waitFor(() => {
      expect(contactsApi.list).toHaveBeenLastCalledWith({ search: 'x', page: 1, pageSize: 25 });
    });
  });
});

describe('ContactsTable — pagination', () => {
  test('hides the pagination bar when everything fits on one page', async () => {
    render(<ContactsTable />);
    await settled();

    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });

  test('shows the page count once there is more than one page', async () => {
    contactsApi.list.mockResolvedValue(listResult([CONTACT], 60));

    render(<ContactsTable />);

    // 60 / 25 = 3 pages.
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
  });

  test('disables Previous on the first page and Next on the last', async () => {
    const user = userEvent.setup();
    contactsApi.list.mockResolvedValue(listResult([CONTACT], 60));

    render(<ContactsTable />);
    await screen.findByText('Page 1 of 3');
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await screen.findByText('Page 3 of 3');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
  });

  test('refetches with the new page number', async () => {
    const user = userEvent.setup();
    contactsApi.list.mockResolvedValue(listResult([CONTACT], 60));

    render(<ContactsTable />);
    await screen.findByText('Page 1 of 3');

    await user.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(contactsApi.list).toHaveBeenLastCalledWith({ search: '', page: 2, pageSize: 25 });
    });
  });
});

describe('ContactsTable — create and edit', () => {
  test('opens an empty form from "+ Add contact"', async () => {
    const user = userEvent.setup();
    render(<ContactsTable />);
    await settled();

    expect(screen.queryByTestId('contact-form')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /\+ add contact/i }));

    expect(screen.getByTestId('contact-form')).toBeInTheDocument();
    // Must be null, not {} — ContactForm titles itself "Edit contact" for any
    // truthy contact, so {} would mislabel a brand-new record.
    expect(screen.getByTestId('form-contact-arg')).toHaveTextContent('null');
  });

  test('the mobile floating button also opens an empty form', async () => {
    const user = userEvent.setup();
    render(<ContactsTable />);
    await settled();

    await user.click(screen.getByRole('button', { name: 'Add contact' }));

    expect(screen.getByTestId('form-contact-arg')).toHaveTextContent('null');
  });

  test('opens the form pre-filled when editing a row', async () => {
    const user = userEvent.setup();
    render(<ContactsTable />);
    await settled();

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);

    expect(screen.getByTestId('form-contact-arg')).toHaveTextContent('object:1');
  });

  test('saving a new contact calls create, then reloads and closes', async () => {
    const user = userEvent.setup();
    render(<ContactsTable />);
    await settled();
    const callsBefore = contactsApi.list.mock.calls.length;

    await user.click(screen.getByRole('button', { name: /\+ add contact/i }));
    await user.click(screen.getByRole('button', { name: 'form-save' }));

    await waitFor(() => expect(contactsApi.create).toHaveBeenCalledWith({ first_name: 'Saved' }));
    expect(contactsApi.update).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(contactsApi.list.mock.calls.length).toBeGreaterThan(callsBefore);
    });
    expect(screen.queryByTestId('contact-form')).not.toBeInTheDocument();
  });

  test('saving an existing contact calls update with its id', async () => {
    const user = userEvent.setup();
    render(<ContactsTable />);
    await settled();

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('button', { name: 'form-save' }));

    await waitFor(() => {
      expect(contactsApi.update).toHaveBeenCalledWith(1, { first_name: 'Saved' });
    });
    expect(contactsApi.create).not.toHaveBeenCalled();
  });

  test('cancelling closes the form without saving', async () => {
    const user = userEvent.setup();
    render(<ContactsTable />);
    await settled();

    await user.click(screen.getByRole('button', { name: /\+ add contact/i }));
    await user.click(screen.getByRole('button', { name: 'form-cancel' }));

    expect(screen.queryByTestId('contact-form')).not.toBeInTheDocument();
    expect(contactsApi.create).not.toHaveBeenCalled();
    expect(contactsApi.update).not.toHaveBeenCalled();
  });
});

describe('ContactsTable — delete', () => {
  test('deletes and reloads once the confirmation is accepted', async () => {
    const user = userEvent.setup();
    render(<ContactsTable />);
    await settled();
    const callsBefore = contactsApi.list.mock.calls.length;

    await user.click(screen.getAllByRole('button', { name: 'Delete' })[0]);

    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(contactsApi.remove).toHaveBeenCalledWith(1));
    await waitFor(() => {
      expect(contactsApi.list.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  test('does nothing when the confirmation is dismissed', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('confirm', vi.fn(() => false));
    render(<ContactsTable />);
    await settled();

    await user.click(screen.getAllByRole('button', { name: 'Delete' })[0]);

    expect(contactsApi.remove).not.toHaveBeenCalled();
  });
});

describe('ContactsTable — sensitive data reveal', () => {
  test('shows a dash for contacts with nothing encrypted', async () => {
    contactsApi.list.mockResolvedValue(listResult([PLAIN_CONTACT], 1));

    render(<ContactsTable />);
    await settled();

    expect(screen.queryByRole('button', { name: /sensitive info/i })).not.toBeInTheDocument();
  });

  test('reveals with the typed password and renders the decrypted fields', async () => {
    const user = userEvent.setup();
    contactsApi.revealSensitive.mockResolvedValue({
      dob: '1990-04-12',
      dietarySpecialNeeds: {
        foodAllergies: ['Peanut', 'Shellfish'],
        accessibilityNeeds: ['Wheelchair access'],
        otherNotes: 'Aisle seat',
      },
    });

    render(<ContactsTable />);
    await settled();

    await user.click(screen.getByRole('button', { name: /sensitive info/i }));
    await user.type(screen.getByPlaceholderText('Your password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(contactsApi.revealSensitive).toHaveBeenCalledWith(1, 'hunter2');
    });

    expect(await screen.findByText('DOB: 1990-04-12')).toBeInTheDocument();
    expect(screen.getByText('Allergies: Peanut, Shellfish')).toBeInTheDocument();
    expect(screen.getByText('Accessibility: Wheelchair access')).toBeInTheDocument();
    expect(screen.getByText('Notes: Aisle seat')).toBeInTheDocument();
  });

  test('Enter in the password field submits the reveal', async () => {
    const user = userEvent.setup();
    contactsApi.revealSensitive.mockResolvedValue({ dob: '1990-04-12' });

    render(<ContactsTable />);
    await settled();

    await user.click(screen.getByRole('button', { name: /sensitive info/i }));
    await user.type(screen.getByPlaceholderText('Your password'), 'hunter2{Enter}');

    await waitFor(() => expect(contactsApi.revealSensitive).toHaveBeenCalledWith(1, 'hunter2'));
  });

  test('shows the error and stays locked on a wrong password', async () => {
    const user = userEvent.setup();
    contactsApi.revealSensitive.mockRejectedValue(new Error('Incorrect password'));

    render(<ContactsTable />);
    await settled();

    await user.click(screen.getByRole('button', { name: /sensitive info/i }));
    await user.type(screen.getByPlaceholderText('Your password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Incorrect password')).toBeInTheDocument();
    expect(screen.queryByText(/^DOB:/)).not.toBeInTheDocument();
  });

  test('cancelling the prompt clears the error and hides the input', async () => {
    const user = userEvent.setup();
    contactsApi.revealSensitive.mockRejectedValue(new Error('Incorrect password'));

    render(<ContactsTable />);
    await settled();

    await user.click(screen.getByRole('button', { name: /sensitive info/i }));
    await user.type(screen.getByPlaceholderText('Your password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await screen.findByText('Incorrect password');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Incorrect password')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Your password')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sensitive info/i })).toBeInTheDocument();
  });

  test('only prompts for the row that was clicked', async () => {
    const user = userEvent.setup();
    const second = { ...CONTACT, id: 5, email: 'second@example.com' };
    contactsApi.list.mockResolvedValue(listResult([CONTACT, second], 2));

    render(<ContactsTable />);
    await settled();

    await user.click(screen.getAllByRole('button', { name: /sensitive info/i })[1]);

    // One prompt open, and the other row still shows its reveal link.
    expect(screen.getAllByPlaceholderText('Your password')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /sensitive info/i })).toHaveLength(1);

    contactsApi.revealSensitive.mockResolvedValue({ dob: '2000-01-01' });
    await user.type(screen.getByPlaceholderText('Your password'), 'pw');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(contactsApi.revealSensitive).toHaveBeenCalledWith(5, 'pw'));
  });
});

describe('ContactsTable — import modal', () => {
  test('opens and closes the import modal', async () => {
    const user = userEvent.setup();
    render(<ContactsTable />);
    await settled();

    expect(screen.queryByTestId('import-modal')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /import csv\/excel/i }));
    expect(screen.getByTestId('import-modal')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'import-close' }));
    expect(screen.queryByTestId('import-modal')).not.toBeInTheDocument();
  });

  test('a completed import reloads the list', async () => {
    const user = userEvent.setup();
    render(<ContactsTable />);
    await settled();
    const callsBefore = contactsApi.list.mock.calls.length;

    await user.click(screen.getByRole('button', { name: /import csv\/excel/i }));
    await user.click(screen.getByRole('button', { name: 'import-done' }));

    await waitFor(() => {
      expect(contactsApi.list.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});