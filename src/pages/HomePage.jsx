import React from 'react';
import { Helmet } from 'react-helmet';
import Navbar from '@/components/Navbar';
import HeroSection from '@/components/HeroSection';
import TravelSearch from '@/components/TravelSearch';
import HowItWorks from '@/components/HowItWorks';
import UnitedStatesSection from '@/components/UnitedStatesSection';
import CaribbeanSection from '@/components/CaribbeanSection';
import MexicoSection from '@/components/MexicoSection';
import EuropeSection from '@/components/EuropeSection';
import CanadaSection from '@/components/CanadaSection';
import AboutSection from '@/components/AboutSection';
import ContactSection from '@/components/ContactSection';

const HomePage = () => {
  return (
    <>
      <Helmet>
        <title>Sky Unlimited Travel | Flight & Hotel Booking for US & Canada</title>
        <meta name="description" content="Sky Unlimited Travel offers premium travel booking for flights, hotels, and vacation packages to the US, Canada, Europe, Caribbean, and Mexico. Start planning your dream getaway today." />
        <meta name="robots" content="index, follow" />
        <link rel="canonical" href="https://skyunlimitedtravelinc.com/" />
        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Sky Unlimited Travel | Flight & Hotel Booking for US & Canada" />
        <meta property="og:description" content="Premium travel booking for flights, hotels, and vacation packages to the US, Canada, Europe, Caribbean, and Mexico." />
        <meta property="og:url" content="https://skyunlimitedtravelinc.com/" />
        <meta property="og:image" content="https://skyunlimitedtravelinc.com/og-image.jpg" />
        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Sky Unlimited Travel | Flight & Hotel Booking for US & Canada" />
        <meta name="twitter:description" content="Premium travel booking for flights, hotels, and vacation packages to the US, Canada, Europe, Caribbean, and Mexico." />
        <meta name="twitter:image" content="https://skyunlimitedtravelinc.com/og-image.jpg" />
      </Helmet>
      <div className="min-h-screen bg-white font-sans text-slate-900 selection:bg-blue-100">
        <Navbar />
        <main>
          <HeroSection />
          <TravelSearch />
          <div id="destinations">
            <UnitedStatesSection />
            <CaribbeanSection />
            <MexicoSection />
            <EuropeSection />
            <CanadaSection />
          </div>
          <div id="how-it-works">
            <HowItWorks />
          </div>
          <div id="about">
            <AboutSection />
          </div>
          <div id="contact">
            <ContactSection />
          </div>
        </main>
        <footer className="bg-[#1a2947] text-white py-8 text-center border-t border-white/10">
          <div className="max-w-7xl mx-auto px-6">
            <div className="flex justify-center mb-4">
              <a href={"https://www.facebook.com/profile.php?id=100090546195854&mibextid=wwXIfr"}
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/60 hover:text-white transition-colors duration-200"
                aria-label="Follow us on Facebook"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
                </svg>
              </a>
            </div>
            <p className="opacity-60 text-sm">© {new Date().getFullYear()} Sky Unlimited Travel Inc. All rights reserved.</p>
          </div>
        </footer>
      </div>
    </>
  );
};

export default HomePage;