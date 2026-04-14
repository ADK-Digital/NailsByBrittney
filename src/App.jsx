import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EMAIL, INSTAGRAM_URL, PHONE_DISPLAY, PHONE_LINK, SAMPLE_BIO } from './lib/constants';
import { fetchGalleryItems, fetchServices, fetchTestimonials } from './lib/api';
import { createBookingRequest, fetchAvailability } from './lib/bookingApi';
import './styles.css';
import logo from '../Images/logo.png';

const navItems = [['home', 'Home'], ['about', 'About'], ['examples', 'Examples'], ['services', 'Services'], ['booking', 'Booking'], ['contact', 'Contact'], ['location', 'Location']];

function SectionHeading({ title, eyebrow }) { return <div className="section-heading">{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2></div>; }

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(media.matches);
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return reduced;
}

function GalleryCarousel({ items, interval = 6000 }) {
  const reducedMotion = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (reducedMotion || items.length <= 1) return undefined;
    const id = setInterval(() => setIndex((curr) => (curr + 1) % items.length), interval);
    return () => clearInterval(id);
  }, [items.length, interval, reducedMotion]);

  useEffect(() => {
    if (index > items.length - 1) setIndex(0);
  }, [items.length, index]);

  const go = (delta) => setIndex((curr) => (curr + delta + items.length) % items.length);

  if (!items.length) return null;

  const item = items[index];
  const src = item.imageUrl || item.local_path;

  return <div className="carousel">
    <button type="button" className="carousel-control" aria-label="Previous image" onClick={() => go(-1)}>‹</button>
    <div className="carousel-content">
      {src ? (
        <button type="button" className="gallery-slide">
          <img src={src} loading="lazy" alt={item.caption || 'Nail service example'} />
        </button>
      ) : <div className="missing-image">Add image in admin</div>}
    </div>
    <button type="button" className="carousel-control" aria-label="Next image" onClick={() => go(1)}>›</button>
  </div>;
}

function BookingSection({ services }) {
  const [selectedServices, setSelectedServices] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', email: '', notes: '' });
  const [pendingMessage, setPendingMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const selected = services.filter((s) => selectedServices.includes(s.id));
  const duration = selected.reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
  const totalMin = selected.reduce((sum, s) => sum + Number(s.price_min_numeric || 0), 0);
  const startsAt = selected.some((s) => s.is_variable_price);

  useEffect(() => {
    if (!selectedServices.length) return;
    fetchAvailability(selectedServices).then((data) => setAvailability(data.dates || []));
  }, [selectedServices.join(',')]);

  const times = useMemo(() => availability.find((d) => d.date === selectedDate)?.times || [], [availability, selectedDate]);

  const toggleService = (id) => {
    setSelectedDate('');
    setSelectedTime('');
    setSelectedServices((curr) => curr.includes(id) ? curr.filter((x) => x !== id) : [...curr, id]);
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await createBookingRequest({
        ...form,
        date: selectedDate,
        time: selectedTime,
        serviceIds: selectedServices,
        idempotencyKey: crypto.randomUUID(),
      });
      setPendingMessage(result.pendingMessage);
      setForm({ firstName: '', lastName: '', phone: '', email: '', notes: '' });
      setSelectedDate('');
      setSelectedTime('');
      setSelectedServices([]);
      setAvailability([]);
    } catch (error) {
      setPendingMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  return <section id="booking" className="section alt"><div className="container"><SectionHeading title="Book an Appointment" eyebrow="Real-time Scheduler" />
    <div className="booking-grid">
      <div>
        <h3>1. Select service(s)</h3>
        {services.filter((s) => s.active !== false).map((s) => <label key={s.id} className="service-check"><input type="checkbox" checked={selectedServices.includes(s.id)} onChange={() => toggleService(s.id)} /> {s.name} — {s.price_text} • {s.duration_minutes || 0} min</label>)}
        {!!selected.length && <p className="muted">Estimated length: {duration} min. {startsAt ? `Estimated total starts at $${totalMin.toFixed(2)}` : `Estimated total is $${totalMin.toFixed(2)}`}</p>}
      </div>
      <div>
        <h3>2. Choose date</h3>
        <div className="date-list">{availability.map((d) => <button key={d.date} className={`date-pill ${d.available ? 'available' : 'unavailable'} ${selectedDate === d.date ? 'selected' : ''}`} disabled={!d.available} onClick={() => { setSelectedDate(d.date); setSelectedTime(''); }}>{d.date}</button>)}</div>
        {selectedDate && <><h3>3. Choose time</h3><div className="date-list">{times.map((t) => <button key={t} className={`time-pill ${selectedTime === t ? 'selected' : ''}`} onClick={() => setSelectedTime(t)}>{t}</button>)}</div></>}
      </div>
    </div>
    <form onSubmit={submit} className="booking-form">
      <h3>4. Your details</h3>
      <div className="split"><label>First name<input required value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} /></label><label>Last name<input required value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} /></label></div>
      <div className="split"><label>Phone<input required pattern="[0-9]{10}" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))} /></label><label>Email<input required type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></label></div>
      <label>Notes<textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></label>
      <button className="btn primary" disabled={busy || !selectedTime || !selectedServices.length}>{busy ? 'Submitting...' : 'Submit booking request'}</button>
      {pendingMessage && <p className="muted">{pendingMessage}</p>}
    </form>
  </div></section>;
}

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [services, setServices] = useState([]);
  const [testimonials, setTestimonials] = useState([]);
  const [gallery, setGallery] = useState([]);

  useEffect(() => { Promise.all([fetchServices(), fetchTestimonials(), fetchGalleryItems()]).then(([s, t, g]) => { setServices(s); setTestimonials(t); setGallery(g); }); }, []);

  const hasImages = useMemo(() => gallery.some((item) => item.imageUrl || item.local_path), [gallery]);

  return <>
    <header className="sticky-nav"><div className="container nav-inner"><a href="#home" className="brand-mini">Nails by Brittney</a><button className="menu-toggle" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>Menu</button><nav className={`nav-links ${menuOpen ? 'open' : ''}`}>{navItems.map(([id, label]) => <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)}>{label}</a>)}<Link to="/admin">Admin</Link></nav></div></header>
    <main>
      <section id="home" className="section hero"><div className="container hero-inner"><img src={logo} className="hero-logo" alt="Nails by Brittney logo" /><h1>Nails by Brittney</h1><p className="subtitle">Certified Nail Technician</p><div className="cta-row"><a href="#booking" className="btn primary">Book Appointment</a><a href={`tel:${PHONE_LINK}`} className="btn">Call to Book</a><a href={INSTAGRAM_URL} target="_blank" rel="noreferrer" className="btn ghost">Instagram</a></div></div></section>
      <section id="about" className="section about-section"><div className="container split"><div className="headshot-placeholder">Headshot Placeholder</div><div><SectionHeading title="Brittney Prosser, Certified Nail Technician" eyebrow="About" /><p>{SAMPLE_BIO}</p></div></div></section>
      <section id="examples" className="section alt"><div className="container"><SectionHeading title="Examples" eyebrow="Portfolio" /><h3>Testimonials</h3>{testimonials.map((item) => <blockquote key={item.id}>"{item.quote}" <span>- {item.customer}</span></blockquote>)}<h3>Gallery</h3><GalleryCarousel items={gallery} />{!hasImages && <p className="muted">Upload images in admin.</p>}</div></section>
      <section id="services" className="section"><div className="container"><SectionHeading title="Services and Pricing" eyebrow="Signature Menu" /><div className="service-grid">{services.map((service) => <article key={service.id} className="card"><h3>{service.name}</h3><p className="meta">{service.price_text} • {service.duration || `${service.duration_minutes} min`}</p><p>{service.description}</p></article>)}</div></div></section>
      <BookingSection services={services} />
      <section id="contact" className="section alt"><div className="container"><SectionHeading title="Contact" eyebrow="Get in Touch" /><p className="contact-blurb"><strong>Nails by Brittney: {PHONE_DISPLAY} (call or text)</strong><br />{EMAIL}</p><div className="cta-row"><a href="#booking" className="btn primary">Open Scheduler</a><a href={`sms:${PHONE_LINK}`} className="btn">Text</a><a href={INSTAGRAM_URL} target="_blank" rel="noreferrer" className="btn ghost">Instagram</a></div></div></section>
      <section id="location" className="section"><div className="container split"><div><SectionHeading title="Location" eyebrow="Visit" /><p>Brittney Prosser at "Bronzed and Polished"<br />139 Eastview Dr<br />Emerald Isle NC 28594<br />{PHONE_DISPLAY}<br />{EMAIL}</p></div><div className="map-shell"><iframe title="Map" className="map" loading="lazy" src="https://www.google.com/maps?q=139%20Eastview%20Dr%2C%20Emerald%20Isle%20NC%2028594&output=embed" /></div></div></section>
    </main>
  </>;
}
