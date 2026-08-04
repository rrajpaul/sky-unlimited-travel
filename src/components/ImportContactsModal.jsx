import { useState, useRef } from 'react';
import { Upload, FileSpreadsheet, X, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { contactsApi } from '../api/crmApi';

export default function ImportContactsModal({ onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | uploading | done | error
  const [result, setResult] = useState(null);
  const fileInputRef = useRef(null);

  const handleFileSelect = (selected) => {
    if (!selected) return;
    if (!selected.name.endsWith('.xlsx')) {
      setResult({ error: 'Please upload an .xlsx file.' });
      setStatus('error');
      return;
    }
    setFile(selected);
    setStatus('idle');
    setResult(null);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files?.[0]);
  };

  const handleImport = async () => {
    if (!file) return;
    setStatus('uploading');
    try {
      const data = await contactsApi.import(file);
      setResult(data);
      setStatus('done');
      onImported?.();
    } catch (err) {
      setResult({ error: err.message });
      setStatus('error');
    }
  };

  const totalUnmatched =
    (result?.unmatchedAddressRows?.length || 0) +
    (result?.unmatchedPassportRows?.length || 0) +
    (result?.unmatchedDietaryRows?.length || 0);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Import Contacts</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        {status === 'idle' && (
          <>
            <p className="text-sm text-slate-500 mb-4">
              Upload the CRM workbook (.xlsx) — Client Index, Address, Passport Info,
              Dietary &amp; Special Needs, Consents, and Emergency Contact sheets.
            </p>

            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                isDragging ? 'border-slate-900 bg-slate-50' : 'border-slate-300 hover:border-slate-400'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => handleFileSelect(e.target.files?.[0])}
              />
              {file ? (
                <div className="flex items-center justify-center gap-2 text-slate-700">
                  <FileSpreadsheet size={20} />
                  <span className="font-medium text-sm">{file.name}</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-slate-400">
                  <Upload size={28} />
                  <span className="text-sm">Drag a file here, or click to browse</span>
                </div>
              )}
            </div>

            <button
              onClick={handleImport}
              disabled={!file}
              className="w-full mt-4 bg-slate-900 text-white font-medium py-2.5 rounded-md disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors"
            >
              Import contacts
            </button>
          </>
        )}

        {status === 'uploading' && (
          <div className="flex flex-col items-center gap-3 py-10 text-slate-700">
            <Loader2 size={28} className="animate-spin" />
            <span className="text-sm font-medium">Importing contacts…</span>
          </div>
        )}

        {status === 'done' && result && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-green-700 bg-green-50 rounded-md px-4 py-3">
              <CheckCircle2 size={20} />
              <span className="text-sm font-medium">
                Created {result.created}, updated {result.updated} contact
                {result.updated === 1 ? '' : 's'}.
              </span>
            </div>

            {result.errors?.length > 0 && (
              <div className="bg-red-50 rounded-md px-4 py-3">
                <div className="flex items-center gap-2 text-red-700 mb-2">
                  <AlertTriangle size={18} />
                  <span className="text-sm font-semibold">
                    {result.errors.length} row{result.errors.length === 1 ? '' : 's'} failed to import
                  </span>
                </div>
                <ul className="text-xs text-red-700 space-y-1 max-h-32 overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <li key={i}>{e.legalFullName}: {e.error}</li>
                  ))}
                </ul>
              </div>
            )}

            {totalUnmatched > 0 && (
              <div className="bg-amber-50 rounded-md px-4 py-3">
                <div className="flex items-center gap-2 text-amber-700 mb-2">
                  <AlertTriangle size={18} />
                  <span className="text-sm font-semibold">
                    {totalUnmatched} record{totalUnmatched === 1 ? '' : 's'} couldn't be matched to a client
                  </span>
                </div>
                <p className="text-xs text-amber-700 mb-2">
                  These names appear in a sheet but didn't match anyone in the Client Index —
                  likely a spelling difference. Review and re-import once fixed.
                </p>
                <ul className="text-xs text-amber-700 space-y-1 max-h-32 overflow-y-auto">
                  {result.unmatchedAddressRows?.map((n, i) => <li key={`a-${i}`}>Address: {n}</li>)}
                  {result.unmatchedPassportRows?.map((n, i) => <li key={`p-${i}`}>Passport: {n}</li>)}
                  {result.unmatchedDietaryRows?.map((n, i) => <li key={`d-${i}`}>Dietary: {n}</li>)}
                </ul>
              </div>
            )}

            <button
              onClick={onClose}
              className="w-full bg-slate-100 text-slate-900 font-medium py-2.5 rounded-md hover:bg-slate-200 transition-colors"
            >
              Done
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-red-700 bg-red-50 rounded-md px-4 py-3">
              <AlertTriangle size={20} />
              <span className="text-sm font-medium">{result?.error || 'Something went wrong.'}</span>
            </div>
            <button
              onClick={() => setStatus('idle')}
              className="w-full bg-slate-900 text-white font-medium py-2.5 rounded-md hover:bg-slate-800 transition-colors"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}