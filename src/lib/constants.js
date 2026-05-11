export const PHONE_DISPLAY = '(252) 888-7757';
export const PHONE_LINK = '+12528887757';
export const EMAIL = 'nailsbybrittneyp@gmail.com';
export const INSTAGRAM_URL = 'https://www.instagram.com/nailss_by_brittneyy/';

export const SAMPLE_BIO = `I am Brittney Prosser, a licensed nail technician since 2025 with a detail-oriented approach. I focus on clean, beautiful, personalized nail services so every guest leaves feeling polished and confident.`;

export const SAMPLE_TESTIMONIALS = [
  { id: 'sample-1', customer: 'Jasmine R.', quote: 'Brittney is so precise and professional—my nails have never looked better.' },
  { id: 'sample-2', customer: 'Kara M.', quote: 'The studio is relaxing, clean, and my gel manicure lasted beautifully for weeks.' },
  { id: 'sample-3', customer: 'Alyssa T.', quote: 'Absolutely love the detail work and care. Booking is easy and service is always amazing.' },
];

const baseServices = [
  { name: 'No Polish Manicure', description: 'Natural manicure without polish.', price_text: '$30', price_min_numeric: 30, duration_minutes: 30, is_variable_price: false, type: 'base', requires_service_ids: [] },
  { name: 'Manicure with Gel Polish', description: 'Luxury manicure with gel polish.', price_text: '$35', price_min_numeric: 35, duration_minutes: 45, is_variable_price: false, type: 'base', requires_service_ids: [] },
  { name: 'Gel X', description: 'Durable Gel X extensions.', price_text: '$50', price_min_numeric: 50, duration_minutes: 75, is_variable_price: false, type: 'base', requires_service_ids: [] },
  { name: 'Structured (soft) Gel Overlay', description: 'Protective gel overlay.', price_text: '$50', price_min_numeric: 50, duration_minutes: 75, is_variable_price: false, type: 'base', requires_service_ids: [] },
  { name: 'Rebalance/Fill', description: 'Includes basic manicure.', price_text: '$45', price_min_numeric: 45, duration_minutes: 75, is_variable_price: false, type: 'base', requires_service_ids: [] },
  { name: 'Pedicure without Polish', description: 'Relaxing pedicure without polish.', price_text: '$35', price_min_numeric: 35, duration_minutes: 35, is_variable_price: false, type: 'base', requires_service_ids: [] },
  { name: 'Pedicure with Gel Polish', description: 'Pedicure with chip-resistant gel polish.', price_text: '$40', price_min_numeric: 40, duration_minutes: 45, is_variable_price: false, type: 'base', requires_service_ids: [] },
  { name: 'French Tip Design', description: 'Classic French tip add-on.', price_text: '$5', price_min_numeric: 5, duration_minutes: 10, is_variable_price: false, type: 'addon', requires_service_ids: [] },
  { name: 'Minimal Nail Design', description: 'Dotting, flowers, line work.', price_text: '$8', price_min_numeric: 8, duration_minutes: 15, is_variable_price: false, type: 'addon', requires_service_ids: [] },
  { name: 'Full Design', description: 'Intricate line work, gems, 3D work.', price_text: '$10+', price_min_numeric: 10, duration_minutes: 25, is_variable_price: true, type: 'addon', requires_service_ids: [] },
  { name: 'Soak Off/File Off', description: 'Gentle gel removal service.', price_text: '$8', price_min_numeric: 8, duration_minutes: 30, is_variable_price: false, type: 'addon', requires_service_ids: [] },
];

export const SAMPLE_SERVICES = baseServices.map((service, idx) => ({
  ...service,
  id: `sample-service-${idx + 1}`,
  duration: `${service.duration_minutes} min`,
  active: true,
  display_order: idx + 1,
}));

export const SAMPLE_GALLERY = Array.from({ length: 6 }).map((_, idx) => ({
  id: `sample-gallery-${idx + 1}`,
  storage_key: `seed/image${idx}.jpeg`,
  local_path: `/images/image${idx}.jpeg`,
  caption: `Nail set example ${idx + 1}`,
  display_order: idx + 1,
}));
