import React, { useState, useEffect } from 'react';
import { apiUrl } from '@/lib/api';

const emptyDraft = { subject: '', htmlBody: '', tagsInput: '' };

// Matches the Bearer-token pattern used elsewhere in the admin app
// (see AdminPage's checkAuth/loadRegistrations, which use
// localStorage.getItem('adminToken')).
const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
});

const statusBadgeClasses = {
  draft: 'bg-slate-100 text-slate-700',
  queued: 'bg-blue-100 text-blue-700',
  sending: 'bg-amber-100 text-amber-700',
  sent: 'bg-emerald-100 text-emerald-700',
};

const recipientStatusClasses = {
  pending: 'text-slate-500',
  sent: 'text-emerald-600',
  failed: 'text-red-600',
};

const CampaignsTab = () => {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null); // null = creating new
  const [draft, setDraft] = useState(emptyDraft);
  const [draftLoading, setDraftLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [previewCount, setPreviewCount] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [sendingId, setSendingId] = useState(null);
  const [actionError, setActionError] = useState('');

  // Recipient targeting for a draft campaign: 'tags' uses the campaign's
  // filter_tags (the normal broadcast path); 'manual' lets the admin pick
  // specific contacts by hand — mainly for test sends without emailing
  // an entire tag-filtered audience.
  const [recipientMode, setRecipientMode] = useState('tags');
  const [availableContacts, setAvailableContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [selectedContactIds, setSelectedContactIds] = useState(() => new Set());


  const fetchCampaigns = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(apiUrl('/api/campaigns'), { headers: authHeaders() });
      if (!res.ok) throw new Error('Failed to load campaigns');
      const data = await res.json();
      setCampaigns(data);
    } catch (err) {
      console.error('Load campaigns error:', err);
      setLoadError('Failed to load campaigns.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCampaigns();
  }, []);


  const openCreateForm = () => {
    setEditingId(null);
    setDraft(emptyDraft);
    setFormError('');
    setShowForm(true);
  };

  // NOTE: the campaigns list (GET /api/campaigns) only returns summary
  // fields for the table — subject, status, filter_tags, sent/failed
  // counts, created_at. It does NOT include html_body. Passing the list
  // row straight into the form left the HTML body empty on edit, so we
  // fetch the full campaign record by ID first (same pattern as
  // openDetail) before populating the draft.
  const openEditForm = async (campaign) => {
    setEditingId(campaign.id);
    setFormError('');
    setDraft(emptyDraft);
    setShowForm(true);
    setDraftLoading(true);

    try {
      const res = await fetch(apiUrl(`/api/campaigns/${campaign.id}`), { headers: authHeaders() });
      if (!res.ok) throw new Error('Failed to load campaign');
      const full = await res.json();
      setDraft({
        subject: full.subject,
        htmlBody: full.html_body,
        tagsInput: (full.filter_tags || []).join(', '),
      });
    } catch (err) {
      console.error('Load campaign for edit error:', err);
      setFormError('Failed to load campaign content.');
    } finally {
      setDraftLoading(false);
    }
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setDraft(emptyDraft);
    setFormError('');
  };

  const parseTags = (tagsInput) =>
    tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

  const handleSaveDraft = async (e) => {
    e.preventDefault();

    if (!draft.subject.trim() || !draft.htmlBody.trim()) {
      setFormError('Subject and HTML body are required.');
      return;
    }

    setSaving(true);
    setFormError('');

    const payload = {
      subject: draft.subject,
      htmlBody: draft.htmlBody,
      filterTags: parseTags(draft.tagsInput),
    };

    try {
      const url = editingId ? apiUrl(`/api/campaigns/${editingId}`) : apiUrl('/api/campaigns');
      const method = editingId ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to save campaign');

      closeForm();
      fetchCampaigns();
    } catch (err) {
      setFormError(err.message || 'Failed to save campaign.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this draft campaign? This cannot be undone.')) return;

    setActionError('');
    try {
      const res = await fetch(apiUrl(`/api/campaigns/${id}`), {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to delete campaign');

      if (selectedCampaign?.id === id) setSelectedCampaign(null);
      fetchCampaigns();
    } catch (err) {
      setActionError(err.message || 'Failed to delete campaign.');
    }
  };


  const openDetail = async (campaign) => {
    setDetailLoading(true);
    setSelectedCampaign(null);
    setPreviewCount(null);
    setActionError('');
    setRecipientMode('tags');
    setSelectedContactIds(new Set());
    setContactSearch('');
    try {
      const res = await fetch(apiUrl(`/api/campaigns/${campaign.id}`), { headers: authHeaders() });
      if (!res.ok) throw new Error('Failed to load campaign details');
      const data = await res.json();
      setSelectedCampaign(data);
    } catch (err) {
      console.error('Load campaign detail error:', err);
      setActionError('Failed to load campaign details.');
    } finally {
      setDetailLoading(false);
    }
  };

  // While a campaign is queued or actively sending, poll for updated
  // recipient statuses so progress (sent/failed counts) shows up live
  // without the admin needing to manually reopen the panel.
  useEffect(() => {
    if (!selectedCampaign) return;
    if (selectedCampaign.status !== 'queued' && selectedCampaign.status !== 'sending') return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(apiUrl(`/api/campaigns/${selectedCampaign.id}`), { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        setSelectedCampaign(data);
        if (data.status === 'sent') {
          fetchCampaigns();
        }
      } catch (err) {
        console.error('Poll campaign status error:', err);
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [selectedCampaign?.id, selectedCampaign?.status]);

  const loadAvailableContacts = async () => {
    if (availableContacts.length > 0) return; // already loaded this session
    setContactsLoading(true);
    try {
      const res = await fetch(apiUrl('/api/campaigns/available-contacts'), {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Failed to load contacts');
      const data = await res.json();
      setAvailableContacts(data);
    } catch (err) {
      console.error('Load available contacts error:', err);
      setActionError('Failed to load contacts for selection.');
    } finally {
      setContactsLoading(false);
    }
  };

  const switchToManualMode = () => {
    setRecipientMode('manual');
    loadAvailableContacts();
  };

  const toggleContactSelected = (contactId) => {
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) {
        next.delete(contactId);
      } else {
        next.add(contactId);
      }
      return next;
    });
  };

  const filteredAvailableContacts = availableContacts.filter((c) => {
    if (!contactSearch.trim()) return true;
    const q = contactSearch.toLowerCase();
    return (
      c.first_name?.toLowerCase().includes(q) ||
      c.last_name?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.tags?.some((t) => t.toLowerCase().includes(q))
    );
  });

  const selectAllFiltered = () => {
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      filteredAvailableContacts.forEach((c) => next.add(c.id));
      return next;
    });
  };

  const clearSelection = () => setSelectedContactIds(new Set());

  const handlePreviewRecipients = async (id) => {
    setPreviewLoading(true);
    setPreviewCount(null);
    try {
      const res = await fetch(apiUrl(`/api/campaigns/${id}/preview-recipients`), {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to preview recipients');
      setPreviewCount(data.count);
    } catch (err) {
      setActionError(err.message || 'Failed to preview recipients.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSend = async (campaign) => {
    const isManual = recipientMode === 'manual';
    const manualCount = selectedContactIds.size;

    if (isManual && manualCount === 0) {
      setActionError('Select at least one contact before sending.');
      return;
    }

    const confirmMsg = isManual
      ? `Queue "${campaign.subject}" to send to the ${manualCount} selected contact(s)? Sending happens in the background and can't be undone once it starts.`
      : previewCount != null
      ? `Queue "${campaign.subject}" to send to ${previewCount} contact(s)? Sending happens in the background and can't be undone once it starts.`
      : `Queue "${campaign.subject}" for sending? Sending happens in the background and can't be undone once it starts.`;

    if (!window.confirm(confirmMsg)) return;

    setSendingId(campaign.id);
    setActionError('');

    try {
      const res = await fetch(apiUrl(`/api/campaigns/${campaign.id}/send`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(isManual ? { contactIds: [...selectedContactIds] } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to send campaign');

      fetchCampaigns();
      openDetail(campaign);
    } catch (err) {
      setActionError(err.message || 'Failed to send campaign.');
    } finally {
      setSendingId(null);
    }
  };


  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold text-slate-900">Campaigns</h2>
        <button
          onClick={openCreateForm}
          className="bg-[#1a2947] text-white font-medium rounded-lg px-4 py-2 hover:bg-[#243a63] transition-colors"
        >
          New Campaign
        </button>
      </div>

      {actionError && (
        <p role="alert" className="text-red-600 text-sm mb-4">
          {actionError}
        </p>
      )}

      {/* Campaign list */}
      {loading ? (
        <p className="text-slate-500">Loading campaigns…</p>
      ) : loadError ? (
        <p className="text-red-600">{loadError}</p>
      ) : campaigns.length === 0 ? (
        <p className="text-slate-500">No campaigns yet.</p>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2">Subject</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Tags</th>
                <th className="px-4 py-2">Sent / Failed</th>
                <th className="px-4 py-2">Created</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <button
                      onClick={() => openDetail(c)}
                      className="text-[#1a2947] font-medium hover:underline text-left"
                    >
                      {c.subject}
                    </button>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${statusBadgeClasses[c.status] || 'bg-slate-100 text-slate-700'}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {c.filter_tags?.length ? c.filter_tags.join(', ') : 'All contacts'}
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {c.sent_count} / {c.failed_count}
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {new Date(c.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2 text-right space-x-3">
                    {c.status === 'draft' && (
                      <>
                        <button
                          onClick={() => openEditForm(c)}
                          className="text-slate-500 hover:text-slate-800 text-xs font-medium"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(c.id)}
                          className="text-red-500 hover:text-red-700 text-xs font-medium"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / edit draft form */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <form
            onSubmit={handleSaveDraft}
            className="bg-white rounded-xl p-6 max-w-2xl w-full shadow-lg max-h-[90vh] overflow-y-auto"
          >
            <h3 className="text-lg font-semibold text-slate-900 mb-4">
              {editingId ? 'Edit Draft Campaign' : 'New Campaign'}
            </h3>

            {draftLoading ? (
              <p className="text-slate-500 mb-4">Loading campaign content…</p>
            ) : (
              <>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Subject</label>
                  <input
                    type="text"
                    required
                    value={draft.subject}
                    onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1a2947]"
                    placeholder="Your exclusive summer travel deals"
                  />
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Filter tags <span className="text-slate-400 font-normal">(comma-separated, leave empty to send to all contacts)</span>
                  </label>
                  <input
                    type="text"
                    value={draft.tagsInput}
                    onChange={(e) => setDraft({ ...draft, tagsInput: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1a2947]"
                    placeholder="newsletter, bahamas-interest"
                  />
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-slate-700 mb-1">HTML body</label>
                  <textarea
                    required
                    rows={10}
                    value={draft.htmlBody}
                    onChange={(e) => setDraft({ ...draft, htmlBody: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#1a2947]"
                    placeholder="<p>Hi there...</p>"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    An unsubscribe link is appended automatically when the campaign is sent.
                  </p>
                </div>
              </>
            )}

            {formError && (
              <p role="alert" className="text-red-600 text-sm mb-4">{formError}</p>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={closeForm}
                className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || draftLoading}
                className="bg-[#1a2947] text-white font-medium rounded-lg px-4 py-2 hover:bg-[#243a63] transition-colors disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save Draft'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Campaign detail / send panel */}
      {(detailLoading || selectedCampaign) && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 max-w-2xl w-full shadow-lg max-h-[90vh] overflow-y-auto">
            {detailLoading ? (
              <p className="text-slate-500">Loading…</p>
            ) : (
              <>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">{selectedCampaign.subject}</h3>
                    <span className={`inline-block mt-1 text-xs font-medium px-2 py-1 rounded-full ${statusBadgeClasses[selectedCampaign.status] || 'bg-slate-100 text-slate-700'}`}>
                      {selectedCampaign.status}
                    </span>
                  </div>
                  <button
                    onClick={() => setSelectedCampaign(null)}
                    className="text-slate-400 hover:text-slate-700"
                  >
                    ✕
                  </button>
                </div>

                <p className="text-sm text-slate-500 mb-4">
                  Tags: {selectedCampaign.filter_tags?.length ? selectedCampaign.filter_tags.join(', ') : 'All contacts'}
                </p>

                {selectedCampaign.status === 'draft' && (
                  <div className="mb-4 border border-slate-200 rounded-lg p-4">
                    <p className="text-sm font-semibold text-slate-700 mb-2">Recipients</p>

                    <div className="flex gap-4 mb-3">
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="radio"
                          checked={recipientMode === 'tags'}
                          onChange={() => setRecipientMode('tags')}
                        />
                        Use filter tags
                      </label>
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="radio"
                          checked={recipientMode === 'manual'}
                          onChange={switchToManualMode}
                        />
                        Select specific contacts
                      </label>
                    </div>

                    {recipientMode === 'tags' && (
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => handlePreviewRecipients(selectedCampaign.id)}
                          disabled={previewLoading}
                          className="text-sm text-[#1a2947] font-medium hover:underline disabled:opacity-60"
                        >
                          {previewLoading ? 'Checking…' : 'Preview audience size'}
                        </button>
                        {previewCount != null && (
                          <span className="text-sm text-slate-500">{previewCount} contact(s) match</span>
                        )}
                      </div>
                    )}

                    {recipientMode === 'manual' && (
                      <div>
                        <div className="flex items-center gap-3 mb-2">
                          <input
                            type="text"
                            value={contactSearch}
                            onChange={(e) => setContactSearch(e.target.value)}
                            placeholder="Search name, email, or tag…"
                            className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1a2947]"
                          />
                          <span className="text-xs text-slate-500 whitespace-nowrap">
                            {selectedContactIds.size} selected
                          </span>
                        </div>

                        <div className="flex gap-3 mb-2">
                          <button
                            onClick={selectAllFiltered}
                            className="text-xs text-[#1a2947] font-medium hover:underline"
                          >
                            Select all {contactSearch.trim() ? 'matching' : ''} ({filteredAvailableContacts.length})
                          </button>
                          <button
                            onClick={clearSelection}
                            className="text-xs text-slate-500 hover:underline"
                          >
                            Clear selection
                          </button>
                        </div>

                        {contactsLoading ? (
                          <p className="text-sm text-slate-500">Loading contacts…</p>
                        ) : (
                          <div className="border border-slate-200 rounded-lg max-h-48 overflow-y-auto">
                            {filteredAvailableContacts.length === 0 ? (
                              <p className="text-sm text-slate-400 p-3">No contacts match.</p>
                            ) : (
                              filteredAvailableContacts.map((c) => (
                                <label
                                  key={c.id}
                                  className="flex items-center gap-2 px-3 py-1.5 text-sm border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer"
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedContactIds.has(c.id)}
                                    onChange={() => toggleContactSelected(c.id)}
                                  />
                                  <span className="text-slate-800">{c.first_name} {c.last_name}</span>
                                  <span className="text-slate-400">{c.email}</span>
                                  {c.tags?.length > 0 && (
                                    <span className="text-xs text-slate-400 ml-auto">{c.tags.join(', ')}</span>
                                  )}
                                </label>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {selectedCampaign.status === 'draft' && (
                  <button
                    onClick={() => handleSend(selectedCampaign)}
                    disabled={sendingId === selectedCampaign.id || (recipientMode === 'manual' && selectedContactIds.size === 0)}
                    className="w-full bg-[#1a2947] text-white font-semibold rounded-lg py-3 hover:bg-[#243a63] transition-colors mb-6 disabled:opacity-60"
                  >
                    {sendingId === selectedCampaign.id
                      ? 'Queuing…'
                      : recipientMode === 'manual'
                      ? `Send to ${selectedContactIds.size} Selected`
                      : 'Send Now'}
                  </button>
                )}

                {(selectedCampaign.status === 'queued' || selectedCampaign.status === 'sending') && (
                  <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                    {selectedCampaign.status === 'queued'
                      ? 'Queued — sending will begin shortly.'
                      : `Sending in progress… ${selectedCampaign.recipients?.filter((r) => r.status !== 'pending').length || 0} / ${selectedCampaign.recipients?.length || 0} processed.`}
                    <span className="block text-xs text-amber-600 mt-1">This updates automatically.</span>
                  </div>
                )}

                {selectedCampaign.recipients?.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-slate-700 mb-2">
                      Recipients ({selectedCampaign.recipients.length})
                    </h4>
                    <div className="border border-slate-200 rounded-lg max-h-64 overflow-y-auto">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-600 sticky top-0">
                          <tr>
                            <th className="px-3 py-2">Name</th>
                            <th className="px-3 py-2">Email</th>
                            <th className="px-3 py-2">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedCampaign.recipients.map((r) => (
                            <tr key={r.id} className="border-t border-slate-100">
                              <td className="px-3 py-2">{r.first_name} {r.last_name}</td>
                              <td className="px-3 py-2 text-slate-500">{r.email}</td>
                              <td className={`px-3 py-2 font-medium ${recipientStatusClasses[r.status] || ''}`}>
                                {r.status}
                                {r.error && (
                                  <span className="block text-xs text-red-400 font-normal">{r.error}</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CampaignsTab;