import React from 'react';
import { motion } from 'framer-motion';

const companySpecialties = [
  'Group Vacations',
  'Individual & Family Travel',
  'Destination Weddings & Honeymoons',
  'World Cruises',
];

const tashaSpecialties = [
  'Group Travel',
  'Ocean & River Cruises',
  'All-Inclusive Vacations',
  'Family Getaways',
  'Destination Celebrations',
  'Customized Vacation Planning',
];

const AboutSection = () => {
  return (
    <>
      {/* ===== Company Story ===== */}
      <section className="py-24 bg-white">
        <div className="max-w-5xl mx-auto px-4">
          <motion.div
            className="text-center mb-14"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <p className="text-sm font-semibold uppercase tracking-wider text-[#1a2947] opacity-60 mb-3">
              About Sky Unlimited Travel
            </p>
            <h2 className="text-3xl md:text-4xl font-bold text-[#1a2947] mb-6">
              Where Your Journey Begins and Extraordinary Memories Last a Lifetime
            </h2>
            <p className="text-lg text-slate-600 leading-relaxed max-w-3xl mx-auto">
              At Sky Unlimited Travel, we believe that travel is more than simply reaching a
              destination—it's about creating unforgettable experiences, celebrating life's
              special moments, and discovering the world with confidence. Since 2020, we have
              proudly helped travelers turn their dream vacations into reality through
              personalized planning and exceptional service.
            </p>
          </motion.div>

          <motion.p
            className="text-slate-600 leading-relaxed text-center max-w-3xl mx-auto mb-6"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            As a TICO-certified travel agency in Canada and CLIA-certified in the United States,
            we are committed to providing professional, knowledgeable, and trustworthy travel
            services that give you peace of mind every step of the way.
          </motion.p>

          <motion.p
            className="text-slate-600 leading-relaxed text-center max-w-3xl mx-auto mb-14"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            Whether you're planning a relaxing beach escape, an exciting cruise, an unforgettable
            family vacation, a destination wedding, a faith-based journey, or a
            once-in-a-lifetime group adventure, we take care of every detail so you can focus on
            making memories.
          </motion.p>

          {/* Specialties */}
          <motion.div
            className="mb-16"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            <h3 className="text-xl font-bold text-[#1a2947] text-center mb-6">
              Our Specialties
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto">
              {companySpecialties.map((item) => (
                <div
                  key={item}
                  className="bg-blue-50 rounded-xl px-4 py-5 text-center text-sm font-medium text-[#1a2947]"
                >
                  {item}
                </div>
              ))}
            </div>
          </motion.div>

          {/* Why Choose Us */}
          <motion.div
            className="max-w-3xl mx-auto mb-14"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            <h3 className="text-xl font-bold text-[#1a2947] text-center mb-4">
              Why Choose Sky Unlimited Travel?
            </h3>
            <p className="text-slate-600 leading-relaxed text-center mb-4">
              We don't believe in one-size-fits-all vacations. Every itinerary is thoughtfully
              designed around your unique travel style, budget, and dreams. Through our strong
              relationships with leading airlines, world-class resorts, renowned cruise lines,
              hotels, and trusted tour partners, we provide exceptional value, exclusive
              opportunities, and seamless travel experiences.
            </p>
            <p className="text-slate-600 leading-relaxed text-center mb-4">
              From your very first consultation until you return home, you'll receive
              personalized attention, expert guidance, and dedicated support. We treat every
              vacation as if it were our own because your satisfaction is the heart of everything
              we do.
            </p>
            <p className="text-slate-600 leading-relaxed text-center">
              Our greatest compliment is when clients return to book their next adventure—and
              recommend us to their family and friends. That's the level of service we strive to
              deliver every single day.
            </p>
          </motion.div>

          <motion.div
            className="text-center"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            <h3 className="text-xl font-bold text-[#1a2947] mb-3">
              Let Your Next Adventure Begin
            </h3>
            <p className="text-slate-600 leading-relaxed max-w-3xl mx-auto">
              Whether you're exploring the Caribbean, cruising through Alaska, discovering
              Europe, experiencing Africa, relaxing in an overwater villa, or checking off a
              destination from your bucket list, Sky Unlimited Travel is here to make it
              effortless and unforgettable. The world is waiting. Your next extraordinary journey
              starts with Sky Unlimited Travel—where exceptional service meets unforgettable
              experiences.
            </p>
          </motion.div>
        </div>
      </section>

      {/* ===== Meet Tasha ===== */}
      <section className="py-24 bg-slate-50">
        <div className="max-w-5xl mx-auto px-4">
          <div className="grid md:grid-cols-5 gap-12 items-start">
            {/* Photo */}
            <motion.div
              className="md:col-span-2"
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <div className="sticky top-24">
                <img
                  src="/tasha-photo.jpg"
                  alt="Natasha (Frankia) Renwick, Founder of Sky Unlimited Travel"
                  className="w-full aspect-[4/5] object-cover rounded-2xl shadow-lg"
                />
                <p className="mt-4 text-center font-bold text-[#1a2947]">
                  Natasha (Frankia) Renwick
                </p>
                <p className="text-center text-sm text-slate-500">
                  Founder & Travel Designer
                </p>
              </div>
            </motion.div>

            {/* Bio */}
            <motion.div
              className="md:col-span-3"
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.1 }}
            >
              <p className="text-sm font-semibold uppercase tracking-wider text-[#1a2947] opacity-60 mb-3">
                Meet Your Travel Designer
              </p>
              <h2 className="text-3xl font-bold text-[#1a2947] mb-6">
                Hi, I'm the Founder of Sky Unlimited Travel
              </h2>

              <div className="space-y-4 text-slate-600 leading-relaxed">
                <p>
                  Where every journey is thoughtfully designed with one goal in mind—to create
                  unforgettable travel experiences that are seamless, memorable, and completely
                  personalized.
                </p>
                <p>
                  Travel has been a part of my life for as long as I can remember. Growing up, I
                  watched my father explore the world simply because he had a passion for
                  discovering new places and cultures. His love for travel inspired my own, and
                  from an early age I knew that one day I wanted to help others experience the joy
                  and excitement that comes from seeing the world.
                </p>
                <p className="font-semibold text-[#1a2947]">
                  That passion eventually became my career.
                </p>
                <p>
                  With more than 15 years of hands-on experience in the travel and hospitality
                  industry, I've had the privilege of working in resorts, car rentals, travel
                  companies, and customer service before launching Sky Unlimited Travel in 2022.
                  Those experiences gave me an insider's understanding of how the travel industry
                  works and, more importantly, how to advocate for my clients before, during, and
                  after their trip.
                </p>
                <p>
                  Today, I proudly serve travelers as a TICO-certified Travel Designer in Canada
                  and a CLIA-certified Cruise Specialist in the United States, providing trusted
                  guidance and professional expertise every step of the way.
                </p>
              </div>

              {/* Specialties */}
              <div className="mt-8 mb-8">
                <h3 className="font-bold text-[#1a2947] mb-3">My Specialties</h3>
                <div className="flex flex-wrap gap-2">
                  {tashaSpecialties.map((item) => (
                    <span
                      key={item}
                      className="text-sm font-medium text-[#1a2947] bg-blue-50 rounded-full px-4 py-2"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>

              <div className="space-y-4 text-slate-600 leading-relaxed">
                <p>
                  What truly sets me apart is that I'm not just a travel professional—I'm also an
                  avid traveler. I've experienced both the incredible moments and the unexpected
                  challenges that can happen while traveling. Those personal experiences allow me
                  to prepare my clients for situations they may never think about when booking on
                  their own.
                </p>
                <p>
                  From passport and travel documentation requirements to travel insurance,
                  airline policies, resort expectations, entry requirements, and
                  destination-specific tips, I provide the guidance that helps eliminate surprises
                  and gives you confidence before you leave home.
                </p>
                <p>
                  I believe every vacation should be exciting—not stressful. That's why I'm
                  committed to providing personalized service, honest advice, and ongoing support
                  from the moment you start planning until you safely return home.
                </p>
                <p>
                  When you book with Sky Unlimited Travel, you're not simply booking a
                  vacation. You're gaining a dedicated Travel Designer who genuinely cares about
                  your experience and treats every trip with the same level of care and attention
                  I would expect for my own family.
                </p>
                <p className="font-semibold text-[#1a2947]">
                  I love what I do, and nothing brings me greater joy than helping my clients
                  create lifelong memories around the world.
                </p>
              </div>
            </motion.div>
          </div>
        </div>
      </section>
    </>
  );
};

export default AboutSection;