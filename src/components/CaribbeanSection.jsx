import React from 'react';
import { motion } from 'framer-motion';
import DestinationCard from './DestinationCard';
import { destinationsData } from '../data/destinations';

const CaribbeanSection = () => {
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
          <span className="text-sm font-bold tracking-widest text-blue-600 uppercase">Tropical Paradise</span>
          <h2 className="text-4xl md:text-5xl font-bold text-[#1a2947] mt-2 mb-4">The Caribbean</h2>
          <div className="w-20 h-1 bg-[#1a2947] mx-auto"></div>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <DestinationCard data={destinationsData.jamaica} />
          
          {/* Overriding image for Antigua with AI generation */}
          <DestinationCard 
            data={{
              ...destinationsData.antigua,
              image: <img alt="Antigua Beaches" src="/images/destinations/antigua.jpg" />
            }} 
          />
          
          {/* Overriding image for Trinidad with AI generation */}
          <DestinationCard 
            data={{
              ...destinationsData.trinidad,
              image: <img alt="Trinidad Carnival and Nature" src="/images/destinations/trinidad.jpg" />
            }} 
          />
        </div>
      </div>
    </section>
  );
};

export default CaribbeanSection;