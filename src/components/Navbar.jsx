import React, { useState, useEffect } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import BookingProcessModal from '@/components/BookingProcessModal';

const Navbar = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const { scrollY } = useScroll();

  const backgroundColor = useTransform(
    scrollY,
    [0, 50],
    ['rgba(255, 255, 255, 0)', 'rgba(255, 255, 255, 0.95)']
  );
  const textColor = useTransform(
    scrollY,
    [0, 50],
    ['rgba(255, 255, 255, 1)', 'rgba(26, 41, 71, 1)']
  );
  const boxShadow = useTransform(
    scrollY,
    [0, 50],
    ['none', '0 4px 6px -1px rgba(0, 0, 0, 0.1)']
  );

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <motion.nav
      style={{ backgroundColor, boxShadow }}
      className="fixed top-0 left-0 right-0 z-50 px-6 py-4 transition-all duration-300"
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <a href="/" className="flex items-center gap-3">
          <img
            src="/logo.png"
            alt="Sky Unlimited Travel Logo"
            className="h-10 w-auto rounded-full border border-white/20"
          />
          <motion.span
            style={{ color: textColor }}
            className="font-bold text-lg hidden sm:block tracking-wide"
          >
            SKY UNLIMITED TRAVEL
          </motion.span>
        </a>

        <div className="hidden md:flex gap-8">
          {['Destinations', 'How It Works', 'About', 'Contact'].map((item) => (
            <motion.a
              key={item}
              href={`/#${item.toLowerCase().replace(/\s+/g, '-')}`}
              style={{ color: textColor }}
              className="text-sm font-medium hover:opacity-70 transition-opacity"
              whileHover={{ scale: 1.05 }}
            >
              {item}
            </motion.a>
          ))}
        </div>

        <BookingProcessModal>
          <motion.button
            className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors duration-300 border-2 ${isScrolled ? 'border-[#1a2947] text-[#1a2947] hover:bg-[#1a2947] hover:text-white' : 'border-white text-white hover:bg-white hover:text-[#1a2947]'}`}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            Book Now
          </motion.button>
        </BookingProcessModal>
      </div>
    </motion.nav>
  );
};

export default Navbar;