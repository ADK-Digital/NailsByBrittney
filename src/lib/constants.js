export const PHONE_DISPLAY = '(518) 729-7251';
export const PHONE_LINK = '+15187297251';
export const EMAIL = 'nailsbybrittneyp@gmail.com';
export const INSTAGRAM_URL = 'https://www.instagram.com/nailss_by_brittneyy/';

export const SAMPLE_BIO = `I am Brittney Prosser, a certified nail technician since 2025 with a detail-oriented approach. I focus on clean, beautiful, personalized nail services so every guest leaves feeling polished and confident.`;

export const SAMPLE_TESTIMONIALS = [
  { id: 'sample-1', customer: 'Jasmine R.', quote: 'Brittney is so precise and professional—my nails have never looked better.' },
  { id: 'sample-2', customer: 'Kara M.', quote: 'The studio is relaxing, clean, and my gel manicure lasted beautifully for weeks.' },
  { id: 'sample-3', customer: 'Alyssa T.', quote: 'Absolutely love the detail work and care. Booking is easy and service is always amazing.' },
];

export const SAMPLE_SERVICES = [
  { name: 'No Polish Manicure', description: 'Indulge in a natural and clean manicure without the polish—perfect for a minimalist look with a touch of pampering! Includes nail shaping, detailed cuticule work, buffed to a shine, followed by a massage and finished with cuticle oil (optional).', price_text: '$30', duration: '30 min' },
  { name: 'Manicure with Gel Polish', description: 'Experience a luxurious manicure with gel polish, keeping your nails looking vibrant and flawless for weeks to come! Includes nail shaping, cuticle work, gel polish color of your choice, followed by a massage and finished with cuticle oil (optional).', price_text: '$35', duration: '45 min' },
  { name: 'Gel X', description: 'Indulge in durable and trendy Gel X extensions for a natural and chic look! Includes basic manicure.', price_text: '$50', duration: '75 min' },
  { name: 'Structured (soft) Gel Overlay', description: 'Enhance your natural nails with a durable and protective gel overlay for a flawless finish that lasts! Includes basic manicure.', price_text: '$50', duration: '75 min' },
  { name: 'Rebalance/Fill', description: 'Includes basic manicure.', price_text: '$45', duration: '75 min' },
  { name: 'Pedicure without Polish', description: "Indulge in a relaxing pedicure treatment focusing on your feet's health and appearance, without the need for polish, leaving your toes feeling refreshed and rejuvenated. Includes nail shaping, cuticle work, massage, sugar scrub and hot towel.", price_text: '$35', duration: '35 min' },
  { name: 'Pedicure with Gel Polish', description: 'Indulge in a relaxing pedicure while enjoying chip-resistant gel polish that keeps your toes looking fabulous for weeks! Includes nail shaping, cuticle work, massage, sugar scrub and hot towel.', price_text: '$40', duration: '45 min' },
  { name: 'French Tip Design', description: 'Elevate your look with French tip nail designs—classic yet stylish for any occasion!', price_text: '$5', duration: '10 min' },
  { name: 'Minimal Nail Design', description: 'Includes dotting, basic flowers, line work, etc.', price_text: '$8', duration: '15 min' },
  { name: 'Full Design', description: 'Intricate line work, gems/crystals/decals, chrome, 3D work.', price_text: '$10+', duration: '25 min' },
  { name: 'Soak Off/File Off', description: 'Effortlessly remove old gel with a gentle soak off/file off service, ensuring a clean and healthy nail bed for your next manicure!', price_text: '$8', duration: '30 min' },
].map((service, idx) => ({ ...service, id: `sample-service-${idx + 1}`, display_order: idx + 1 }));

export const SAMPLE_GALLERY = Array.from({ length: 6 }).map((_, idx) => ({
  id: `sample-gallery-${idx + 1}`,
  storage_key: `seed/image${idx}.jpeg`,
  local_path: `/images/image${idx}.jpeg`,
  caption: `Nail set example ${idx + 1}`,
  display_order: idx + 1,
}));
