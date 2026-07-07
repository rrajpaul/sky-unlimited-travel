import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Calendar, Phone, CreditCard, ChevronRight } from 'lucide-react';
import { apiUrl } from '@/lib/api';
import { destinationsData } from '@/data/destinations'; // adjust path if needed

const steps = [
  { icon: CheckCircle2, title: 'Book with us', description: 'Initiate your travel request.', color: 'text-blue-500' },
  { icon: Calendar, title: 'We follow up', description: 'We will email or call you to schedule a consultation.', color: 'text-purple-500' },
  { icon: Phone, title: 'Consultation', description: 'Complete a detailed consultation over phone or video call.', color: 'text-green-500' },
];

// Single source of truth: build destination options straight from destinationsData.
// "Other" is kept as a manual fallback since it isn't a real entry.
const destinationOptions = [
  ...Object.entries(destinationsData).map(([key, d]) => ({
    key,
    title: d.title,
  })),
  { key: 'other', title: 'Other' },
];

const PANELS = [
  { id: 'contact', title: 'Contact Info', subtitle: 'How can we reach you?' },
  { id: 'destination', title: 'Destination & Dates', subtitle: 'Where and when?' },
  { id: 'details', title: 'Trip Details', subtitle: 'Tell us more' },
];

const BookingProcessModal = ({ children, destination: initialDestination = '' }) => {
  const getInitialForm = () => {
    // initialDestination is a destinationsData key (e.g. "miami"); resolve it to its display title.
    const selected = destinationOptions.find(d => d.key === initialDestination);
    return {
      name: '',
      email: '',
      phone: '',
      destinationKey: initialDestination,
      destination: selected?.title || '',
      fromDate: '',
      toDate: '',
      details: ''
    };
  };

  const [form, setForm] = useState(getInitialForm);
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [open, setOpen] = useState(false);
  const [success, setSuccess] = useState(false);
  const [currentPanel, setCurrentPanel] = useState(0);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleDestinationChange = (e) => {
    const key = e.target.value;
    const selected = destinationOptions.find(d => d.key === key);
    setForm(prev => ({
      ...prev,
      destinationKey: key,
      destination: selected?.title || '',
    }));
  };

  const validatePanel = () => {
    if (currentPanel === 0) {
      if (!form.name.trim()) return 'Full name is required';
      if (!form.email.trim()) return 'Email address is required';
    }
    if (currentPanel === 1) {
      if (!form.destinationKey) return 'Please select a destination';
      if (!form.fromDate) return 'Please select a departure date';
      if (!form.toDate) return 'Please select a return date';
      if (form.fromDate && form.toDate && form.toDate < form.fromDate) return 'Return date must be after departure date';
    }
    return null;
  };

  const handleNext = () => {
    const err = validatePanel();
    if (err) { setErrorMsg(err); return; }
    setErrorMsg('');
    setCurrentPanel(prev => prev + 1);
  };

  const handleBack = () => {
    setErrorMsg('');
    setCurrentPanel(prev => prev - 1);
  };

  const handleProceed = async () => {
    const err = validatePanel();
    if (err) { setErrorMsg(err); return; }

    setStatus('loading');
    setErrorMsg('');

    try {
      // Save inquiry
      const res = await fetch(apiUrl('/api/inquiry'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          timestamp: new Date().toISOString()
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');

      // Notify Tasha
      await fetch(apiUrl('/api/inquiry/notify-admin'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      setSuccess(true);
      setStatus('idle');
    } catch (err) {
      console.error('Inquiry capture failed:', err.message);
      setErrorMsg(err.message || 'Something went wrong. Please try again.');
      setStatus('error');
    }
  };

  const inputClass = "w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#1a2947] transition-colors bg-white";

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      setOpen(isOpen);
      if (!isOpen) {
        setStatus('idle');
        setErrorMsg('');
        setSuccess(false);
        setCurrentPanel(0);
        setForm(getInitialForm());
      }
    }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-md md:max-w-lg bg-white p-0 overflow-hidden border-none shadow-2xl rounded-2xl max-h-[98vh] overflow-y-auto [&>button]:text-white [&>button]:bg-[#1a2947] [&>button]:hover:bg-[#2c426e] [&>button]:rounded-full [&>button]:opacity-100">

        {/* Header */}
        <div className="bg-[#1a2947] p-4 text-white text-center">
          <DialogTitle className="text-xl font-bold mb-1">Booking Process</DialogTitle>
          <DialogDescription className="text-blue-100">
            Your journey to a dream vacation starts here.
          </DialogDescription>
        </div>

        {/* Steps */}
        <div className="px-4 pt-3">
          <div className="space-y-2">
            {steps.map((step, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1, duration: 0.5 }}
                className="flex items-center gap-3 relative"
              >
                {index !== steps.length - 1 && (
                  <div className="absolute left-4 top-8 bottom-[-8px] w-0.5 bg-gray-100"></div>
                )}
                <div className={`w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center shrink-0 z-10 ${step.color}`}>
                  <step.icon className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-[#1a2947] text-sm">{step.title}</h3>
                  <p className="text-xs text-gray-500">{step.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Form */}
        <div className="px-4 pb-4 mt-4">
          {success ? (
            <div className="p-8 text-center">
              <CheckCircle2 className="mx-auto w-12 h-12 text-green-500 mb-3" />
              <h2 className="text-xl font-bold text-[#1a2947]">Thank you!</h2>
              <p className="text-gray-500 mt-2">
                Your travel request has been received. We will contact you within 48-72 hours.
              </p>
            </div>
          ) : (
            <div className="space-y-4">

              {/* Panel indicator */}
              <div className="flex items-center justify-between mb-1">
                <div>
                  <p className="text-sm font-bold text-[#1a2947]">{PANELS[currentPanel].title}</p>
                  <p className="text-xs text-gray-400">{PANELS[currentPanel].subtitle}</p>
                </div>
                <div className="flex gap-1">
                  {PANELS.map((_, i) => (
                    <div
                      key={i}
                      className={`h-1.5 w-6 rounded-full transition-colors duration-300 ${
                        i === currentPanel ? 'bg-[#1a2947]' : i < currentPanel ? 'bg-blue-300' : 'bg-gray-200'
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* All panels inside one AnimatePresence */}
              <AnimatePresence mode="wait">

                {/* Panel 0 — Contact Info */}
                {currentPanel === 0 && (
                  <motion.div
                    key="panel-0"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.25 }}
                    className="space-y-3"
                  >
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Full Name *</label>
                      <input
                        type="text"
                        name="name"
                        value={form.name}
                        onChange={handleChange}
                        placeholder="Your full name"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Email Address *</label>
                      <input
                        type="email"
                        name="email"
                        value={form.email}
                        onChange={handleChange}
                        placeholder="Your email"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Phone (Optional)</label>
                      <input
                        type="tel"
                        name="phone"
                        value={form.phone}
                        onChange={handleChange}
                        placeholder="Your phone"
                        className={inputClass}
                      />
                    </div>
                  </motion.div>
                )}

                {/* Panel 1 — Destination & Dates */}
                {currentPanel === 1 && (
                  <motion.div
                    key="panel-1"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.25 }}
                    className="space-y-3"
                  >
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Destination *</label>
                      <select
                        name="destination"
                        value={form.destinationKey}
                        onChange={handleDestinationChange}
                        className={inputClass}
                      >
                        <option value="">Select destination</option>
                        {destinationOptions.map(d => (
                          <option key={d.key} value={d.key}>{d.title}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Departure Date *</label>
                        <input
                          type="date"
                          name="fromDate"
                          value={form.fromDate}
                          onChange={handleChange}
                          min={new Date().toISOString().split('T')[0]}
                          className={inputClass}
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Return Date *</label>
                        <input
                          type="date"
                          name="toDate"
                          value={form.toDate}
                          onChange={handleChange}
                          min={form.fromDate || new Date().toISOString().split('T')[0]}
                          className={inputClass}
                        />
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* Panel 2 — Trip Details */}
                {currentPanel === 2 && (
                  <motion.div
                    key="panel-2"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.25 }}
                    className="space-y-3"
                  >
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Additional Details</label>
                      <textarea
                        name="details"
                        value={form.details}
                        onChange={handleChange}
                        placeholder="Tell us more about your travel preferences, group size, special requests..."
                        rows={5}
                        className={inputClass}
                      />
                    </div>
                  </motion.div>
                )}

              </AnimatePresence>

              {errorMsg && <p className="text-red-500 text-xs">{errorMsg}</p>}

              {/* Navigation buttons */}
              <div className="flex gap-2 pt-1">
                {currentPanel > 0 && (
                  <Button
                    type="button"
                    onClick={handleBack}
                    className="flex-1 h-11 text-sm bg-gray-100 hover:bg-gray-200 text-[#1a2947] rounded-xl transition-all"
                  >
                    Back
                  </Button>
                )}
                {currentPanel < PANELS.length - 1 ? (
                  <Button
                    type="button"
                    onClick={handleNext}
                    className="flex-1 h-11 text-sm bg-[#1a2947] hover:bg-[#2c426e] text-white rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
                  >
                    Next <ChevronRight className="w-4 h-4" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={handleProceed}
                    disabled={status === 'loading'}
                    className="flex-1 h-11 text-sm bg-[#1a2947] hover:bg-[#2c426e] text-white rounded-xl shadow-lg transition-all disabled:opacity-60"
                  >
                    {status === 'loading' ? 'Processing...' : 'Submit'}
                  </Button>
                )}
              </div>

            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BookingProcessModal;