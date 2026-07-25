import React from 'react';
import { Helmet } from 'react-helmet';
import Navbar from '@/components/Navbar';
import HeroSection from '@/components/HeroSection';
import TravelSearch from '@/components/TravelSearch';
import CarRentalSection from '@/components/CarRentalSection';
import HowItWorks from '@/components/HowItWorks';
import UnitedStatesSection from '@/components/UnitedStatesSection';
import CaribbeanSection from '@/components/CaribbeanSection';
import MexicoSection from '@/components/MexicoSection';
import EuropeSection from '@/components/EuropeSection';
import CanadaSection from '@/components/CanadaSection';
import AboutSection from '@/components/AboutSection';
import ContactSection from '@/components/ContactSection';
import CruisesSection from '@/components/CruisesSection';
import GiveawaySection from '@/components/GiveawaySection';

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
          <section id="giveaway" className="scroll-mt-24">
            <GiveawaySection />
          </section>
          <TravelSearch />
          <CarRentalSection />
          <div id="destinations">
            <UnitedStatesSection />
            <CaribbeanSection />
            <MexicoSection />
            <EuropeSection />
            <CanadaSection />
            <CruisesSection />
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
            <div className="flex justify-center items-center gap-5 mb-4">
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
              <a href={"https://www.instagram.com/skyunlimitedtravel"}
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/60 hover:text-white transition-colors duration-200"
                aria-label="Follow us on Instagram"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2c-2.72 0-3.06.01-4.12.06-1.06.05-1.78.22-2.41.46-.66.25-1.22.6-1.77 1.15a4.9 4.9 0 0 0-1.15 1.77c-.24.63-.41 1.35-.46 2.41C2.01 8.94 2 9.28 2 12s.01 3.06.06 4.12c.05 1.06.22 1.78.46 2.41.25.66.6 1.22 1.15 1.77.55.55 1.11.9 1.77 1.15.63.24 1.35.41 2.41.46 1.06.05 1.4.06 4.12.06s3.06-.01 4.12-.06c1.06-.05 1.78-.22 2.41-.46a4.9 4.9 0 0 0 1.77-1.15 4.9 4.9 0 0 0 1.15-1.77c.24-.63.41-1.35.46-2.41.05-1.06.06-1.4.06-4.12s-.01-3.06-.06-4.12c-.05-1.06-.22-1.78-.46-2.41a4.9 4.9 0 0 0-1.15-1.77 4.9 4.9 0 0 0-1.77-1.15c-.63-.24-1.35-.41-2.41-.46C15.06 2.01 14.72 2 12 2zm0 1.8c2.67 0 2.99.01 4.04.06.98.04 1.5.2 1.86.34.47.18.8.4 1.15.75.35.35.57.68.75 1.15.14.36.3.88.34 1.86.05 1.05.06 1.37.06 4.04s-.01 2.99-.06 4.04c-.04.98-.2 1.5-.34 1.86-.18.47-.4.8-.75 1.15-.35.35-.68.57-1.15.75-.36.14-.88.3-1.86.34-1.05.05-1.37.06-4.04.06s-2.99-.01-4.04-.06c-.98-.04-1.5-.2-1.86-.34a3.1 3.1 0 0 1-1.15-.75 3.1 3.1 0 0 1-.75-1.15c-.14-.36-.3-.88-.34-1.86C3.81 14.99 3.8 14.67 3.8 12s.01-2.99.06-4.04c.04-.98.2-1.5.34-1.86.18-.47.4-.8.75-1.15.35-.35.68-.57 1.15-.75.36-.14.88-.3 1.86-.34C9.01 3.81 9.33 3.8 12 3.8zm0 3.05a5.15 5.15 0 1 0 0 10.3 5.15 5.15 0 0 0 0-10.3zm0 8.5a3.35 3.35 0 1 1 0-6.7 3.35 3.35 0 0 1 0 6.7zm6.56-8.7a1.2 1.2 0 1 1-2.4 0 1.2 1.2 0 0 1 2.4 0z" />
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