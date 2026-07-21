import React from 'react';
import { motion } from 'framer-motion';
import DestinationCard from './DestinationCard';
import { destinationsData } from '../data/destinations';

const CanadaSection = () => {
  return (
    <section className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-6">
        <motion.div 
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <span className="text-sm font-bold tracking-widest text-blue-600 uppercase">True North</span>
          <h2 className="text-4xl md:text-5xl font-bold text-[#1a2947] mt-2 mb-4">Canada</h2>
          <div className="w-20 h-1 bg-[#1a2947] mx-auto"></div>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          <DestinationCard destinationKey="vancouver" data={destinationsData.vancouver} />
          <DestinationCard destinationKey="toronto" data={destinationsData.toronto} />
          {/* Overriding image for Montreal with AI generation */}
          <DestinationCard 
            destinationKey="montreal"
            data={{
              ...destinationsData.montreal,
              image: <img alt="Old Montreal Architecture" src="/images/destinations/montreal.webp" />
            }} 
          />
          <DestinationCard destinationKey="banff" data={destinationsData.banff} />
        </div>
      </div>
    </section>
  );
};

export default CanadaSection;