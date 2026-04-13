import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EMAIL, INSTAGRAM_URL, PHONE_DISPLAY, PHONE_LINK, SAMPLE_BIO } from './lib/constants';
import { fetchGalleryItems, fetchServices, fetchTestimonials } from './lib/api';
import './styles.css';
import logo from '../Images/logo.png';

const navItems = [
  ['home', 'Home'],
  ['about', 'About'],
  ['examples', 'Examples'],
  ['services', 'Services'],
  ['contact', 'Contact'],
  ['location', 'Location'],
];

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

const NailIcon = () => <svg aria-hidden="true" viewBox="0 0 24 24" className="nail-icon"><path d="M7 4.5c2.1-.4 4.4-.4 6.6 0 1 .2 1.7 1.1 1.6 2.1l-.8 8.8c-.2 2-1.9 3.6-4 3.6s-3.8-1.6-4-3.6l-.8-8.8c-.1-1 .6-1.9 1.4-2.1zM9 8h6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>;

function SectionHeading({ title, eyebrow }) {
  return (
    <div className="section-heading">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h2>{title}</h2>
      <span className="heading-flourish" aria-hidden="true" />
    </div>
  );
}

function Carousel({ items, renderItem, interval = 6500 }) {
  const reducedMotion = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [pausedUntil, setPausedUntil] = useState(0);

  useEffect(() => {
    if (reducedMotion || Date.now() < pausedUntil || items.length <= 1) return;
    const id = setInterval(() => setIndex((curr) => (curr + 1) % items.length), interval);
    return () => clearInterval(id);
  }, [items.length, interval, reducedMotion, pausedUntil]);

  useEffect(() => {
    if (index > items.length - 1) setIndex(0);
  }, [items.length, index]);

  const go = (delta) => {
    setPausedUntil(Date.now() + 10000);
    setIndex((curr) => (curr + delta + items.length) % items.length);
  };

  if (!items.length) return null;
  return (
    <div className="carousel" onMouseEnter={() => setPausedUntil(Number.MAX_SAFE_INTEGER)} onMouseLeave={() => setPausedUntil(Date.now() + 2500)}>
      <button className="carousel-control" aria-label="Previous" onClick={() => go(-1)}>‹</button>
      <div className="carousel-content">{renderItem(items[index], index)}</div>
      <button className="carousel-control" aria-label="Next" onClick={() => go(1)}>›</button>
    </div>
  );
}

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [services, setServices] = useState([]);
  const [testimonials, setTestimonials] = useState([]);
  const [gallery, setGallery] = useState([]);
  const [lightbox, setLightbox] = useState(null);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    Promise.all([fetchServices(), fetchTestimonials(), fetchGalleryItems()]).then(([s, t, g]) => {
      setServices(s);
      setTestimonials(t);
      setGallery(g);
    });
  }, []);

  const hasImages = useMemo(() => gallery.some((item) => item.imageUrl || item.local_path), [gallery]);

  const validateForm = (formData) => {
    const next = {};
    if (!formData.get('name')?.trim()) next.name = 'Name is required.';
    if (!/\S+@\S+\.\S+/.test(formData.get('email') || '')) next.email = 'A valid email is required.';
    if (!formData.get('message')?.trim()) next.message = 'Please include a brief message.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  return (
    <>
      <header className="sticky-nav">
        <div className="container nav-inner">
          <a href="#home" className="brand-mini">Nails by Brittney</a>
          <button className="menu-toggle" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>Menu</button>
          <nav className={`nav-links ${menuOpen ? 'open' : ''}`}>
            {navItems.map(([id, label]) => <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)}>{label}</a>)}
            <Link to="/admin">Admin</Link>
          </nav>
        </div>
      </header>

      <main>
        <section id="home" className="section hero">
          <div className="container hero-inner">
            <span className="hero-top-flourish" aria-hidden="true" />
            <img src={logo} className="hero-logo" alt="Nails by Brittney logo" />
            <h1>Nails by Brittney</h1>
            <p className="subtitle">Certified Nail Technician</p>
            <p>Emerald Isle&apos;s premier nail services</p>
            <div className="cta-row">
              <a href={`sms:${PHONE_LINK}`} className="btn primary">Text to Book Now</a>
              <a href={`tel:${PHONE_LINK}`} className="btn">Call to Book Now</a>
              <a href={INSTAGRAM_URL} target="_blank" rel="noreferrer" className="btn ghost">Instagram</a>
            </div>
          </div>
        </section>

        <section id="about" className="section about-section">
          <div className="container split">
            <div className="headshot-placeholder" role="img" aria-label="Placeholder headshot for Brittney Prosser">Headshot Placeholder</div>
            <div>
              <SectionHeading title="Brittney Prosser, Certified Nail Technician" eyebrow="About" />
              <p>{SAMPLE_BIO}</p>
            </div>
          </div>
        </section>

        <section id="examples" className="section alt examples-section">
          <div className="container">
            <SectionHeading title="Examples" eyebrow="Portfolio" />
            <h3>Testimonials</h3>
            <Carousel items={testimonials} renderItem={(item) => <blockquote>&quot;{item.quote}&quot; <span>- {item.customer}</span></blockquote>} />
            <h3>Gallery</h3>
            <Carousel
              items={gallery}
              renderItem={(item) => (
                <button className="gallery-slide" onClick={() => setLightbox(item)}>
                  {(item.imageUrl || item.local_path) ? <img src={item.imageUrl || item.local_path} loading="lazy" alt="Nail service example" /> : <div className="missing-image">Add image in admin</div>}
                </button>
              )}
            />
            {!hasImages && <p className="muted">Sample gallery records are ready; upload images in Admin to display them.</p>}
          </div>
        </section>

        <section id="services" className="section services-section">
          <div className="container">
            <SectionHeading title="Services and Pricing" eyebrow="Signature Menu" />
            <div className="service-grid">
              {services.map((service) => (
                <article key={service.id} className="card">
                  <NailIcon />
                  <h3>{service.name}</h3>
                  <p className="meta">{service.price_text} <span>•</span> {service.duration}</p>
                  <p>{service.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="contact" className="section alt contact-section">
          <div className="container">
            <SectionHeading title="Contact" eyebrow="Get in Touch" />
            <p className="contact-blurb"><strong>Nails by Brittney: {PHONE_DISPLAY} (call or text)</strong><br />{EMAIL}</p>
            <div className="cta-row">
              <a href={`sms:${PHONE_LINK}`} className="btn primary">Text to Book Now</a>
              <a href={`tel:${PHONE_LINK}`} className="btn">Call to Book Now</a>
              <a href={INSTAGRAM_URL} target="_blank" rel="noreferrer" className="btn ghost">Instagram</a>
            </div>
            <form name="contact" method="POST" data-netlify="true" netlify-honeypot="bot-field" onSubmit={(e) => {
              const data = new FormData(e.currentTarget);
              if (!validateForm(data)) e.preventDefault();
            }}>
              <input type="hidden" name="form-name" value="contact" />
              <input type="hidden" name="bot-field" />
              <label>Name<input name="name" aria-invalid={Boolean(errors.name)} required /></label>
              {errors.name && <span className="error">{errors.name}</span>}
              <label>Email<input type="email" name="email" aria-invalid={Boolean(errors.email)} required /></label>
              {errors.email && <span className="error">{errors.email}</span>}
              <label>Phone Number<input name="phone" /></label>
              <fieldset>
                <legend>Preferred contact method</legend>
                <label><input type="checkbox" name="preferred_contact" value="Text" />Text</label>
                <label><input type="checkbox" name="preferred_contact" value="Call" />Call</label>
                <label><input type="checkbox" name="preferred_contact" value="Email" />Email</label>
              </fieldset>
              <label>Topic<select name="topic" defaultValue="questions about services/pricing">
                <option>questions about services/pricing</option>
                <option>appointment availability</option>
                <option>other</option>
              </select></label>
              <label>Message<textarea name="message" aria-invalid={Boolean(errors.message)} required /></label>
              {errors.message && <span className="error">{errors.message}</span>}
              <button className="btn primary" type="submit">Send Message</button>
            </form>
          </div>
        </section>

        <section id="location" className="section location-section">
          <div className="container split">
            <div>
              <SectionHeading title="Location" eyebrow="Visit" />
              <p>Brittney Prosser at &quot;Bronzed and Polished&quot;<br />139 Eastview Dr<br />Emerald Isle NC 28594<br />Hours: Mon-Sat 8am-6pm, walk-ins welcome<br />{PHONE_DISPLAY}<br />{EMAIL}</p>
            </div>
            <div className="map-shell">
              <iframe title="Map to Bronzed and Polished" className="map" loading="lazy" src="https://www.google.com/maps?q=139%20Eastview%20Dr%2C%20Emerald%20Isle%20NC%2028594&output=embed" />
            </div>
          </div>
        </section>
      </main>
      <footer className="footer">© {new Date().getFullYear()} Nails by Brittney. All rights reserved.</footer>

      {lightbox && (
        <div className="lightbox" role="dialog" aria-modal="true" onClick={() => setLightbox(null)}>
          <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
            {(lightbox.imageUrl || lightbox.local_path) ? <img src={lightbox.imageUrl || lightbox.local_path} alt="Nail example enlarged" /> : <div className="missing-image">No image uploaded yet</div>}
            <p>{lightbox.caption || 'Nail service example'}</p>
            <button className="btn" onClick={() => setLightbox(null)}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}
