import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import { CheckCircle2, Calendar, Phone, CreditCard } from 'lucide-react';
import { apiUrl } from '@/lib/api';

const steps = [
  {
    icon: CheckCircle2,
    title: 'Book with us',
    description: 'Initiate your travel request.',
    color: 'text-blue-500',
  },
  {
    icon: Calendar,
    title: 'We follow up',
    description: 'We will email or call you to schedule a consultation.',
    color: 'text-purple-500',
  },
  {
    icon: Phone,
    title: 'Consultation',
    description: 'Complete a detailed consultation over phone or video call.',
    color: 'text-green-500',
  },
  {
    icon: CreditCard,
    title: 'Payment',
    description: 'Securely finalize your booking.',
    color: 'text-orange-500',
  },
];

const countryCities = {
  'France': ['Paris'],
  'England': ['London'],
  'Italy': ['Rome'],
  'USA': ['Miami', 'Orlando'],
  'Spain': ['Barcelona'],
  'Caribbean': ['Jamaica', 'Antigua', 'Trinidad'],
  'Mexico': ['Cancun'],
  'Netherlands': ['Amsterdam'],
  'Canada': ['Vancouver', 'Toronto', 'Montreal', 'Banff'],
  'Other': ['Other']
};

const STRIPE_URL = 'https://buy.stripe.com/9B63cx7II4vfev51iF3Ru01';

const BookingProcessModal = ({ children, country: initialCountry = '', city: initialCity = '' }) => {
  const getInitialForm = () => ({
    name: '',
    email: '',
    phone: '',
    country: initialCountry,
    city: initialCity,
    details: ''
  });

  const [form, setForm] = useState(getInitialForm);
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [open, setOpen] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleProceed = async (e) => {
    e.preventDefault();
    setStatus('loading');
    setErrorMsg('');

    if (!form.name.trim() || !form.email.trim()) {
      setErrorMsg('Name and email are required');
      setStatus('error');
      return;
    }

    try {
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

      setSuccess(true);
      setStatus('idle');
    } catch (err) {
      console.error('Inquiry capture failed:', err.message);
      setErrorMsg(err.message || 'Something went wrong. Please try again.');
      setStatus('error');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      setOpen(isOpen);
      if (!isOpen) {
        setStatus('idle');
        setErrorMsg('');
        setSuccess(false);
        setForm(getInitialForm());
      }
    }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-md md:max-w-lg bg-white p-0 overflow-hidden border-none shadow-2xl rounded-2xl max-h-[98vh] overflow-y-auto">
        <div className="bg-[#1a2947] p-4 text-white text-center">
          <DialogTitle className="text-xl font-bold mb-1">Booking Process</DialogTitle>
          <DialogDescription className="text-blue-100">
            Your journey to a dream vacation starts here.
          </DialogDescription>
        </div>

        <div className="px-4 pt-1 pb-4">
          <div className="space-y-3 mt-0">
            {steps.map((step, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1, duration: 0.5 }}
                className="flex items-center gap-3 relative"
              >
                {index !== steps.length - 1 && (
                  <div className="absolute left-4 top-8 bottom-[-12px] w-0.5 bg-gray-100"></div>
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

          {success ? (
            <div className="p-8 text-center">
              <CheckCircle2 className="mx-auto w-12 h-12 text-green-500 mb-3" />
              <h2 className="text-xl font-bold text-[#1a2947]">Thank you!</h2>
              <p className="text-gray-500 mt-2">
                Your travel request has been received. We will contact you within 48-72 hours.
              </p>
            </div>
          ) : (
            <form onSubmit={handleProceed} className="mt-3 space-y-3 pb-2">
              <p className="text-sm font-semibold text-[#1a2947] mb-1">Your details to get started:</p>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Full Name *</label>
                  <input
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    required
                    placeholder="Your full name"
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#1a2947] transition-colors"
                  />
                </div>

                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Email Address *</label>
                    <input
                      type="email"
                      name="email"
                      value={form.email}
                      onChange={handleChange}
                      required
                      placeholder="Your email"
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#1a2947] transition-colors"
                    />
                  </div>

                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Phone (Optional)</label>
                    <input
                      type="tel"
                      name="phone"
                      value={form.phone}
                      onChange={handleChange}
                      placeholder="Your phone"
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#1a2947] transition-colors"
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Country</label>
                    <select
                      name="country"
                      value={form.country}
                      onChange={(e) => {
                        const selectedCountry = e.target.value;
                        const cities = countryCities[selectedCountry] || [];
                        setForm(prev => ({
                          ...prev,
                          country: selectedCountry,
                          city: cities.length === 1 ? cities[0] : ''
                        }));
                      }}
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#1a2947] transition-colors bg-white"
                    >
                      <option value="">Select country</option>
                      {Object.keys(countryCities).map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-500 mb-1">City</label>
                    <select
                      name="city"
                      value={form.city}
                      onChange={handleChange}
                      disabled={!form.country}
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#1a2947] transition-colors bg-white disabled:opacity-50"
                    >
                      <option value="">Select city</option>
                      {(countryCities[form.country] || []).map(city => (
                        <option key={city} value={city}>{city}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Additional Details</label>
                  <textarea
                    name="details"
                    value={form.details}
                    onChange={handleChange}
                    placeholder="Tell us more about your travel preferences..."
                    rows={2}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-[#1a2947] transition-colors"
                  />
                </div>
              </div>

              {errorMsg && <p className="text-red-500 text-xs">{errorMsg}</p>}

              <Button
                type="submit"
                disabled={status === 'loading'}
                className="w-full h-12 text-base bg-[#1a2947] hover:bg-[#2c426e] text-white rounded-xl shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 group disabled:opacity-60"
              >
                {status === 'loading' ? 'Processing...' : 'Submit'}
              </Button>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BookingProcessModal;