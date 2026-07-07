import React from 'react';
import { motion } from 'framer-motion';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription, 
  DialogTrigger 
} from "@/components/ui/dialog";
import { MapPin, Check } from 'lucide-react';
import BookingProcessModal from '@/components/BookingProcessModal';

// `destinationKey` is the key this entry has inside destinationsData (e.g. "miami").
// It must be passed down from wherever this card is rendered, e.g.:
//   Object.entries(destinationsData).map(([key, data]) => (
//     <DestinationCard key={key} destinationKey={key} data={data} />
//   ))
const DestinationCard = ({ data, destinationKey, className }) => {
  // Handle image source whether it is a string URL or a React Element (from img-replace generation)
  let imageSrc = data.image;
  let imageAlt = data.title;

  if (React.isValidElement(data.image) && data.image.props) {
    // If <img-replace> generated an <img> element, extract its src
    imageSrc = data.image.props.src;
    // Optionally use the alt text from the generated image if available
    if (data.image.props.alt) {
      imageAlt = data.image.props.alt;
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <motion.div 
          className={`relative overflow-hidden rounded-xl cursor-pointer group shadow-lg ${className}`}
          whileHover={{ y: -5 }}
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          {/* Card Image */}
          <div className="h-64 sm:h-80 w-full overflow-hidden">
            <img 
              src={imageSrc} 
              alt={imageAlt}
              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
            />
          </div>
          
          {/* Overlay Gradient */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#1a2947] via-transparent to-transparent opacity-80 group-hover:opacity-90 transition-opacity duration-300"></div>
          
          {/* Card Content */}
          <div className="absolute bottom-0 left-0 right-0 p-6 text-white transform translate-y-2 group-hover:translate-y-0 transition-transform duration-300">
            <p className="text-xs font-semibold tracking-wider uppercase mb-1 opacity-80">{data.subtitle}</p>
            <h3 className="text-2xl font-bold mb-2">{data.title}</h3>
            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 text-sm font-medium text-blue-200">
              <span>View Brochure</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </div>
          </div>
        </motion.div>
      </DialogTrigger>

      {/* Modal Content - Travel Booklet Style */}
      <DialogContent className="max-w-4xl p-0 overflow-hidden bg-white border-none rounded-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex flex-col md:flex-row h-full">
          {/* Left Side: Image */}
          <div className="w-full md:w-2/5 h-64 md:h-auto relative">
            <img 
              src={imageSrc} 
              alt={imageAlt} 
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-[#1a2947]/20"></div>
            <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full flex items-center gap-1">
              <MapPin className="w-4 h-4 text-[#1a2947]" />
              <span className="text-xs font-bold text-[#1a2947] uppercase tracking-wider">Destination</span>
            </div>
          </div>

          {/* Right Side: Content */}
          <div className="w-full md:w-3/5 p-8 md:p-10 flex flex-col justify-between bg-white">
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
                  {data.highlights.map((highlight, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm text-gray-600">
                      <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                      {highlight}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="pt-6 border-t border-gray-100 flex items-center justify-between gap-4">
              <div className="hidden sm:block">
                <p className="text-xs text-gray-400">Ready to explore?</p>
                <p className="text-sm font-bold text-[#1a2947]">Plan your custom trip today</p>
              </div>
              <BookingProcessModal destination={destinationKey}>
                <button
                  className="flex-1 sm:flex-none text-center bg-[#1a2947] text-white px-8 py-3 rounded-lg font-semibold hover:bg-[#2c426e] transition-colors duration-300 shadow-lg hover:shadow-xl"
                >
                  Book Your Trip
                </button>
              </BookingProcessModal>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DestinationCard;