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
          <div id="contact">
            <ContactSection />
          </div>
        </main>
        <footer className="bg-[#1a2947] text-white py-8 text-center border-t border-white/10">
          <div className="max-w-7xl mx-auto px-6">
            <p className="opacity-60 text-sm">© {new Date().getFullYear()} Sky Unlimited Travel Inc. All rights reserved.</p>
          </div>
        </footer>
      </div>
    </>
  );
};

export default HomePage;