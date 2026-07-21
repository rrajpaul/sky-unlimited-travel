import React from 'react';
import { motion } from 'framer-motion';
import BookingProcessModal from '@/components/BookingProcessModal';

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
      <motion.div 
        className="relative z-10 text-center px-4 max-w-4xl mx-auto"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1 }}
      >
        <motion.h1 
          className="text-7xl md:text-8xl lg:text-9xl text-white mb-8 drop-shadow-lg" 
          style={{ fontFamily: 'Allura, cursive' }}
          initial={{ scale: 0.9 }}
          animate={{ scale: 1 }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        >
          Let's plan your getaway
        </motion.h1>
        <motion.p 
          className="text-white/90 text-lg md:text-xl mb-10 max-w-2xl mx-auto font-light tracking-wide"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 1 }}
        >
          Experience the world with Sky Unlimited Travel. Your journey begins here.
        </motion.p>

        <BookingProcessModal>
          <motion.button
            className="inline-block bg-white text-[#1a2947] font-bold px-10 py-4 rounded-full shadow-xl hover:shadow-2xl hover:bg-gray-100 transition-all duration-300 tracking-wider text-sm md:text-base uppercase"
            whileHover={{ scale: 1.05, y: -2 }}
            whileTap={{ scale: 0.95 }}
          >
            Book Your Stay Now
          </motion.button>
        </BookingProcessModal>
      </motion.div>

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