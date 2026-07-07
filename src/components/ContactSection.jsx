import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { apiUrl } from '@/lib/api';

const ContactSection = () => {
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' });
  const [status, setStatus] = useState('idle'); // idle | loading | success | error
  const [errorMsg, setErrorMsg] = useState('');

  const handleChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus('loading');
    setErrorMsg('');
    try {
      const res = await fetch(apiUrl('/api/contact'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      setStatus('success');
      setForm({ name: '', email: '', phone: '', message: '' });
    } catch (err) {
      setErrorMsg(err.message);
      setStatus('error');
    }
  };

  return (
    <section className="relative py-24 overflow-hidden">
      <div className="absolute inset-0">
        <img
          className="w-full h-full object-cover"
          alt="Greek coastal village with white buildings"
          src="https://images.unsplash.com/photo-1533627489758-498ce6c8c1e9"
        />
        <div className="absolute inset-0 bg-[#1a2947] bg-opacity-70"></div>
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-4 text-center">
        <motion.h2
          className="text-4xl font-bold text-white mb-4"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          Plan Your Trip With Sky Unlimited Travel
        </motion.h2>

        <motion.p
          className="text-xl text-white mb-8"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          We can help you fit your stay and experience within your allotted budget.
        </motion.p>

        <motion.div
          className="mb-8"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          <p className="text-white text-sm uppercase tracking-wider mb-4">Call Us Now</p>
          <a
            href="tel:1-866-854-8348"
            className="text-4xl font-bold text-white hover:text-gray-200 transition-colors duration-300 flex items-center justify-center gap-3"
          >
            <span className="text-5xl">📞</span> 1-866-854-8348
          </a>
        </motion.div>

        <motion.div
          className="text-white mb-10"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.4 }}
        >
          <p className="text-lg mb-2">Natasha Renwick</p>
          <a
            href="mailto:info@skyunlimitedtravel.com"
            className="text-blue-300 hover:text-blue-200 transition-colors duration-300"
          >
            info@skyunlimitedtravel.com
          </a>
        </motion.div>

        {/* Contact Form */}
        <motion.div
          className="bg-white bg-opacity-10 backdrop-blur-sm rounded-2xl p-8 text-left"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.5 }}
        >
          <h3 className="text-2xl font-bold text-white mb-6 text-center">Send Us a Message</h3>

          {status === 'success' ? (
            <div className="text-center py-8">
              <p className="text-3xl mb-3">✅</p>
              <p className="text-white text-lg font-semibold">Message sent!</p>
              <p className="text-blue-200 mt-2">We'll be in touch with you shortly.</p>
              <button
                onClick={() => setStatus('idle')}
                className="mt-6 text-sm text-blue-300 hover:text-white underline transition-colors"
              >
                Send another message
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-white text-sm font-medium mb-1">
                    Full Name <span className="text-red-300">*</span>
                  </label>
                  <input
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    required
                    placeholder="Jane Smith"
                    className="w-full px-4 py-3 rounded-xl bg-white bg-opacity-20 text-white placeholder-blue-200 border border-white border-opacity-30 focus:outline-none focus:border-white transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-white text-sm font-medium mb-1">
                    Email <span className="text-red-300">*</span>
                  </label>
                  <input
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    required
                    placeholder="jane@example.com"
                    className="w-full px-4 py-3 rounded-xl bg-white bg-opacity-20 text-white placeholder-blue-200 border border-white border-opacity-30 focus:outline-none focus:border-white transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-white text-sm font-medium mb-1">Phone (optional)</label>
                <input
                  type="tel"
                  name="phone"
                  value={form.phone}
                  onChange={handleChange}
                  placeholder="+1 (555) 000-0000"
                  className="w-full px-4 py-3 rounded-xl bg-white bg-opacity-20 text-white placeholder-blue-200 border border-white border-opacity-30 focus:outline-none focus:border-white transition-colors"
                />
              </div>

              <div>
                <label className="block text-white text-sm font-medium mb-1">
                  Message <span className="text-red-300">*</span>
                </label>
                <textarea
                  name="message"
                  value={form.message}
                  onChange={handleChange}
                  required
                  rows={4}
                  placeholder="Tell us about your dream trip — destination, dates, group size, budget..."
                  className="w-full px-4 py-3 rounded-xl bg-white bg-opacity-20 text-white placeholder-blue-200 border border-white border-opacity-30 focus:outline-none focus:border-white transition-colors resize-none"
                />
              </div>

              {status === 'error' && (
                <p className="text-red-300 text-sm">{errorMsg}</p>
              )}

              <button
                type="submit"
                disabled={status === 'loading'}
                className="w-full h-12 bg-white text-[#1a2947] font-bold rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {status === 'loading' ? 'Sending...' : 'Send Message'}
              </button>
            </form>
          )}
        </motion.div>

        <motion.div
          className="mt-12"
          initial={{ opacity: 0, scale: 0.8 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.6 }}
        >
          <img
            src="https://horizons-cdn.hostinger.com/623e1352-b968-425c-a6cd-1bbd5e65bf5c/5d362fd2245e7b3612555df328a686c5.jpg"
            alt="Sky Unlimited Travel Logo"
            className="w-64 h-auto mx-auto"
          />
        </motion.div>
      </div>
    </section>
  );
};

export default ContactSection;
