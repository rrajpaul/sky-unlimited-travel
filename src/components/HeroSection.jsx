import React from 'react';
import { motion } from 'framer-motion';
import BookingProcessModal from '@/components/BookingProcessModal';

// NOTE: For the font fix to take effect, add this to your document head
// (e.g. _document.js, index.html, or wherever your global <head> lives):
//
// <link
//   rel="preload"
//   href="/fonts/allura.woff2"
//   as="font"
//   type="font/woff2"
//   crossOrigin="anonymous"
// />
//
// And make sure your @font-face rule for Allura includes:
//   font-display: swap;
// This lets the browser show a fallback font instantly, then swap to Allura
// once it loads, instead of hiding the text until the font arrives (FOIT).

const HeroSection = () => {
  return (
    <section className="relative h-screen flex items-center justify-center overflow-hidden">
      {/* Image Background */}
      <div className="absolute inset-0 z-0">
        <img
          src="/images/hero/hero.webp"
          alt="Airplane wing in sky"
          fetchpriority="high"
          className="w-full h-full object-cover"
        />
        {/* Overlay */}
        <div className="absolute inset-0 bg-[#1a2947]/40"></div>
      </div>

      <div className="relative z-10 text-center px-4 max-w-4xl mx-auto">
        {/*
          This h1 is the page's LCP (Largest Contentful Paint) element.
          It is intentionally NOT wrapped in motion/opacity/scale animation
          and does NOT use a drop-shadow filter, since both delay or slow
          down the paint that LCP measures. It renders immediately, in its
          final visual state, as soon as styles + font are ready.
        */}
        <h1
          className="text-7xl md:text-8xl lg:text-9xl text-white mb-8"
          style={{
            fontFamily: 'Allura, cursive',
            textShadow: '0 4px 12px rgba(0,0,0,0.4)', // plain shadow, not a CSS filter
          }}
        >
          Let's plan your getaway
        </h1>

        <motion.p
          className="text-white/90 text-lg md:text-xl mb-10 max-w-2xl mx-auto font-light tracking-wide"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.8 }}
        >
          Experience the world with Sky Unlimited Travel. Your journey begins here.
        </motion.p>

        <BookingProcessModal>
          <motion.button
            className="inline-block bg-white text-[#1a2947] font-bold px-10 py-4 rounded-full shadow-xl hover:shadow-2xl hover:bg-gray-100 transition-all duration-300 tracking-wider text-sm md:text-base uppercase"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.8 }}
            whileHover={{ scale: 1.05, y: -2 }}
            whileTap={{ scale: 0.95 }}
          >
            Book Your Stay Now
          </motion.button>
        </BookingProcessModal>
      </div>

      {/* Scroll indicator */}
      <motion.div
        className="absolute bottom-10 left-1/2 transform -translate-x-1/2 text-white"
        animate={{ y: [0, 10, 0] }}
        transition={{ repeat: Infinity, duration: 2 }}
      >
        <div className="w-6 h-10 border-2 border-white rounded-full flex justify-center p-1">
          <div className="w-1 h-3 bg-white rounded-full"></div>
        </div>
      </motion.div>
    </section>
  );
};

export default HeroSection;