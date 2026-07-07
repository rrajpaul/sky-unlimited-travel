import React from 'react';
import { motion } from 'framer-motion';
import { destinationsData } from '../data/destinations';
import { MapPin, ArrowRight } from 'lucide-react';
import { Dialog, DialogContent, DialogTrigger, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import BookingProcessModal from '@/components/BookingProcessModal';
const MexicoSection = () => {
  const data = destinationsData.cancun;
  return <section className="py-20 relative overflow-hidden bg-[#1a2947] text-white">
      <div className="absolute top-0 right-0 w-1/2 h-full bg-white/5 skew-x-12 transform translate-x-20"></div>
      
      <div className="max-w-7xl mx-auto px-6 relative z-10">
        <div className="flex flex-col lg:flex-row items-center gap-12">
          <motion.div className="w-full lg:w-1/2" initial={{
          opacity: 0,
          x: -50
        }} whileInView={{
          opacity: 1,
          x: 0
        }} viewport={{
          once: true
        }} transition={{
          duration: 0.8
        }}>
            <span className="text-sm font-bold tracking-widest text-blue-300 uppercase">Viva Mexico</span>
            <h2 className="text-5xl md:text-6xl font-bold mt-2 mb-6">Cancun</h2>
            <p className="text-lg text-gray-300 mb-8 leading-relaxed">
              Discover a world where turquoise waters meet white powdery sands. Cancun isn't just a destination; it's an experience of luxury, history, and natural wonder.
            </p>
            
            <Dialog>
              <DialogTrigger asChild>
                <button className="bg-white text-[#1a2947] px-8 py-3 rounded-full font-bold hover:bg-gray-100 transition-colors flex items-center gap-2 group">
                  Explore Cancun
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </button>
              </DialogTrigger>
              
              <DialogContent className="max-w-4xl p-0 overflow-hidden bg-white border-none rounded-2xl max-h-[90vh] overflow-y-auto">
                <div className="flex flex-col md:flex-row h-full">
                  <div className="w-full md:w-2/5 h-64 md:h-auto relative">
                    <img src={data.image} alt={data.title} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-[#1a2947]/20"></div>
                    <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full flex items-center gap-1">
                      <MapPin className="w-4 h-4 text-[#1a2947]" />
                      <span className="text-xs font-bold text-[#1a2947] uppercase tracking-wider">Destination</span>
                    </div>
                  </div>

                  <div className="w-full md:w-3/5 p-8 md:p-10 flex flex-col justify-between bg-white text-left">
                    <div>
                      <DialogHeader className="mb-6 text-left">
                        <p className="text-sm font-bold text-blue-600 uppercase tracking-widest mb-2">{data.subtitle}</p>
                        <DialogTitle className="text-4xl font-serif text-[#1a2947] mb-4">{data.title}</DialogTitle>
                        <DialogDescription className="text-base text-gray-600 leading-relaxed">
                          {data.description}
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 mb-8">
                        <h4 className="text-sm font-bold text-[#1a2947] uppercase tracking-wide border-b border-gray-100 pb-2">Top Experiences</h4>
                        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {data.highlights.map((highlight, index) => <li key={index} className="flex items-start gap-2 text-sm text-gray-600">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-2 shrink-0"></span>
                              {highlight}
                            </li>)}
                        </ul>
                      </div>
                    </div>
                    <div className="pt-6 border-t border-gray-100 flex items-center justify-between gap-4">
                      <BookingProcessModal destination="cancun">
                        <button className="w-full text-center bg-[#1a2947] text-white px-8 py-3 rounded-lg font-semibold hover:bg-[#2c426e] transition-colors duration-300 shadow-lg">
                          Book Your Trip
                        </button>
                      </BookingProcessModal>
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </motion.div>

          <motion.div className="w-full lg:w-1/2" initial={{
          opacity: 0,
          scale: 0.9
        }} whileInView={{
          opacity: 1,
          scale: 1
        }} viewport={{
          once: true
        }} transition={{
          duration: 0.8,
          delay: 0.2
        }}>
            <div className="relative rounded-2xl overflow-hidden shadow-2xl rotate-2 hover:rotate-0 transition-transform duration-500">
              <img src="/images/destinations/cancun.jpg" alt="Cancun Beach" className="w-full h-auto" />
            </div>
          </motion.div>
        </div>
      </div>
    </section>;
};
export default MexicoSection;