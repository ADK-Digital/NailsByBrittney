import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EMAIL, INSTAGRAM_URL, PHONE_DISPLAY, PHONE_LINK, SAMPLE_BIO } from './lib/constants';
import { fetchGalleryItems, fetchServices, fetchTestimonials } from './lib/api';
import { createBookingRequest, fetchAvailability } from './lib/bookingApi';
import SquareCardField from './components/SquareCardField';
import './styles.css';
import logo from '../Images/logo.png';

const navItems = [['home', 'Home'], ['about', 'About'], ['examples', 'Examples'], ['services', 'Services'], ['booking', 'Booking'], ['contact', 'Contact'], ['location', 'Location']];


function getServicePriceNumber(service) {
  const numeric = Number(service.price_min_numeric);
  if (Number.isFinite(numeric)) return numeric;

  const parsed = Number(String(service.price_text || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatServicePrice(service) {
  const priceNumber = getServicePriceNumber(service);
  const formattedPrice = Number.isInteger(priceNumber) ? String(priceNumber) : priceNumber.toFixed(2);
  return `$${formattedPrice}${service.is_variable_price ? '+' : ''}`;
}

function Divider() {
  return <div className="section-separator" aria-hidden="true"><svg viewBox="0 0 600 80" role="presentation" focusable="false" className="flourish-svg"><path className="flourish-line" d="M12 40H204" /><path className="flourish-main" d="M300 40C286 40 279 29 270 22C260 14 246 14 236 22C227 30 227 43 236 51C246 59 260 59 270 51C279 44 286 40 300 40C282 40 268 52 252 60C236 68 216 66 205 53C194 40 196 21 210 12C224 3 245 6 259 16C273 26 285 40 300 40" /><path className="flourish-detail" d="M300 40C289 40 283 34 277 29C271 24 263 24 258 30C253 35 253 44 258 49C263 55 271 55 277 50C283 45 289 40 300 40" /><path className="flourish-cap" d="M20 40L16 36L12 40L16 44Z" /><g transform="translate(600 0) scale(-1 1)"><path className="flourish-line" d="M12 40H204" /><path className="flourish-main" d="M300 40C286 40 279 29 270 22C260 14 246 14 236 22C227 30 227 43 236 51C246 59 260 59 270 51C279 44 286 40 300 40C282 40 268 52 252 60C236 68 216 66 205 53C194 40 196 21 210 12C224 3 245 6 259 16C273 26 285 40 300 40" /><path className="flourish-detail" d="M300 40C289 40 283 34 277 29C271 24 263 24 258 30C253 35 253 44 258 49C263 55 271 55 277 50C283 45 289 40 300 40" /><path className="flourish-cap" d="M20 40L16 36L12 40L16 44Z" /></g><path className="flourish-center" d="M300 33L307 40L300 47L293 40Z" /><circle className="flourish-center-dot" cx="300" cy="40" r="1.7" /></svg></div>;
}

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

  return <div className="carousel"><button type="button" className="carousel-control" aria-label="Previous image" onClick={() => go(-1)}>‹</button><div className="carousel-content">{src ? <button type="button" className="gallery-slide"><span className="gallery-media"><img src={src} loading="lazy" alt={item.caption || 'Nail service example'} /></span></button> : <div className="missing-image">Add image in admin</div>}</div><button type="button" className="carousel-control" aria-label="Next image" onClick={() => go(1)}>›</button></div>;
}

function BookingSection({ services }) {
  const showDevSquareTokenInput = import.meta.env.VITE_ENABLE_SQUARE_DEV_TOKEN_INPUT === 'true';
  const squareCardRef = useRef(null);
  const [selectedServices, setSelectedServices] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [form, setForm] = useState({
    firstName: '', lastName: '', phone: '', email: '', notes: '', communicationPreference: 'both', policyAcknowledged: false,
  });
  const [pendingMessage, setPendingMessage] = useState('');
  const [cardError, setCardError] = useState('');
  const [isSquareReady, setIsSquareReady] = useState(showDevSquareTokenInput);
  const [devSquareToken, setDevSquareToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [serviceError, setServiceError] = useState('');
  const [bookingFlowError, setBookingFlowError] = useState('');
  const [submitValidationError, setSubmitValidationError] = useState('');
  const timeRef = useRef(null);
  const timeSelectRef = useRef(null);
  const shouldSyncAvailabilityRef = useRef(false);

  const selected = services.filter((s) => selectedServices.includes(s.id));
  const isAddonService = (s) => s.is_addon === true || s.type === 'addon';
  const selectedBaseServices = selected.filter((s) => !isAddonService(s));
  const selectedAddonServices = selected.filter((s) => isAddonService(s));
  const duration = selected.reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
  const totalMin = selected.reduce((sum, s) => sum + Number(s.price_min_numeric || 0), 0);
  const startsAt = selected.some((s) => s.is_variable_price);

  useEffect(() => {
    const selected = services.filter((s) => selectedServices.includes(s.id));
    const hasAddon = selected.some((s) => isAddonService(s));
    const hasBase = selected.some((s) => !isAddonService(s));

    if (hasAddon && !hasBase) {
      setServiceError('Add-ons must be booked with a manicure or pedicure.');
      setBookingFlowError('');
      setSelectedDate('');
      setSelectedTime('');
    } else {
      setServiceError('');
    }
  }, [selectedServices, services]);

  useEffect(() => {
    if (!selectedServices.length) {
      shouldSyncAvailabilityRef.current = false;
      setAvailability([]);
      setSelectedDate('');
      setSelectedTime('');
      return undefined;
    }

    let cancelled = false;

    fetchAvailability(selectedServices).then((data) => {
      if (cancelled) return;

      shouldSyncAvailabilityRef.current = true;
      setAvailability(data.dates || []);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedServices.join(',')]);

  useEffect(() => {
    if (selectedDate && timeRef.current) {
      timeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      timeSelectRef.current?.focus({ preventScroll: true });
    }
  }, [selectedDate]);

  function formatTime12Hour(time) {
    const [h, m] = time.split(':').map(Number);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour}:${m.toString().padStart(2, '0')} ${suffix}`;
  }

  const availabilityMap = useMemo(() => {
    return new Map(availability.map((d) => [d.date, d]));
  }, [availability]);
  const times = useMemo(() => {
    return availabilityMap.get(selectedDate)?.times || [];
  }, [availabilityMap, selectedDate]);

  useEffect(() => {
    if (selectedTime && !times.includes(selectedTime)) {
      setSelectedTime('');
    }
  }, [selectedTime, times]);
  const [calendarDate, setCalendarDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  useEffect(() => {
    if (!shouldSyncAvailabilityRef.current) return;

    shouldSyncAvailabilityRef.current = false;

    const availableDates = availability.filter((d) => d.available && d.date);
    const selectedAvailability = selectedDate ? availability.find((d) => d.date === selectedDate) : null;

    if (selectedDate && !selectedAvailability?.available) {
      setSelectedDate('');
      setSelectedTime('');
    }

    if (!availableDates.length) return;

    const earliestAvailableDate = availableDates.reduce((earliest, current) => (current.date < earliest.date ? current : earliest));
    const [year, month] = earliestAvailableDate.date.split('-').map(Number);

    setCalendarDate(new Date(year, month - 1, 1));
  }, [availability, selectedDate]);
  const availableMonthRange = useMemo(() => {
    const availableDates = availability.filter((d) => d.available && d.date);

    if (!availableDates.length) {
      return { min: null, max: null };
    }

    const monthIndexes = availableDates.map((d) => {
      const [year, month] = d.date.split('-').map(Number);
      return (year * 12) + (month - 1);
    });

    return {
      min: Math.min(...monthIndexes),
      max: Math.max(...monthIndexes),
    };
  }, [availability]);
  const calendarYear = calendarDate.getFullYear();
  const calendarMonth = calendarDate.getMonth();
  const calendarMonthIndex = (calendarYear * 12) + calendarMonth;
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const firstWeekday = new Date(calendarYear, calendarMonth, 1).getDay();
  const todayIso = new Date().toISOString().slice(0, 10);
  const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthLabel = calendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const isPreviousMonthDisabled = availableMonthRange.min === null || calendarMonthIndex <= availableMonthRange.min;
  const isNextMonthDisabled = availableMonthRange.max === null || calendarMonthIndex >= availableMonthRange.max;
  const changeCalendarMonth = (delta) => {
    setCalendarDate((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  };

  const toggleService = (id) => {
    setBookingFlowError('');
    setSubmitValidationError('');
    setSelectedServices((curr) => curr.includes(id) ? curr.filter((x) => x !== id) : [...curr, id]);
  };

  const submit = async (e) => {
    e.preventDefault();
    setPendingMessage('');
    setCardError('');
    setBookingFlowError('');
    setServiceError('');
    setSubmitValidationError('');

    if (!selectedServices.length) {
      const message = 'Please select a service from above.';
      setBookingFlowError(message);
      setSubmitValidationError(message);
      return;
    }

    if (!selectedDate) {
      const message = 'Please select an available date from above.';
      setBookingFlowError(message);
      setSubmitValidationError(message);
      return;
    }

    if (!selectedTime) {
      const message = 'Please select an available time from above.';
      setBookingFlowError(message);
      setSubmitValidationError(message);
      return;
    }

    if (selectedAddonServices.length && !selectedBaseServices.length) {
      const message = 'Add-ons must be booked with a manicure or pedicure.';
      setServiceError(message);
      setSubmitValidationError(message);
      return;
    }

    if (!e.currentTarget.checkValidity()) {
      const invalidLabels = Array.from(e.currentTarget.querySelectorAll(':invalid'))
        .map((field) => field.closest('label')?.textContent?.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      const uniqueInvalidLabels = [...new Set(invalidLabels)];
      const requiredDetails = uniqueInvalidLabels.length ? uniqueInvalidLabels.join(', ') : 'all required fields';
      setSubmitValidationError(`Please complete the required booking details: ${requiredDetails}.`);
      return;
    }

    let squareCardToken = '';
    if (showDevSquareTokenInput) {
      squareCardToken = devSquareToken.trim();
      if (!squareCardToken) {
        const message = 'Developer token input is enabled; enter a Square test token to continue.';
        setCardError(message);
        setSubmitValidationError(message);
        return;
      }
    } else {
      if (!squareCardRef.current?.isReady?.()) {
        const message = 'Secure card entry is still loading. Please wait a moment and try again.';
        setCardError(message);
        setSubmitValidationError(message);
        return;
      }
      try {
        squareCardToken = await squareCardRef.current.tokenize();
      } catch (error) {
        const message = error.message || 'Unable to tokenize card. Please review your card details and try again.';
        setCardError(message);
        setSubmitValidationError(message);
        return;
      }
    }

    setBusy(true);
    try {
      const result = await createBookingRequest({
        ...form,
        squareCardToken,
        date: selectedDate,
        time: selectedTime,
        serviceIds: selectedServices,
        idempotencyKey: crypto.randomUUID(),
        cardIdempotencyKey: crypto.randomUUID(),
      });
      setPendingMessage(result.pendingMessage);
      setForm({ firstName: '', lastName: '', phone: '', email: '', notes: '', communicationPreference: 'both', policyAcknowledged: false });
      setDevSquareToken('');
      setSelectedDate('');
      setSelectedTime('');
      setSelectedServices([]);
      setAvailability([]);
    } catch (error) {
      setPendingMessage(error.message || 'Booking submission failed after card tokenization. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const onSquareReadyStateChange = useCallback((ready) => {
    setIsSquareReady(ready);
  }, []);

  return <section id="booking" className="section alt"><div className="container"><SectionHeading title="Book an Appointment" eyebrow="Real-time Scheduler" />
    <div className="booking-grid">
      <div className="booking-services">
        <h3>1. Select service(s)</h3>
        <div className="booking-services-list">
          {services.filter((s) => s.active !== false).map((s) => <label key={s.id} className="service-check"><input type="checkbox" checked={selectedServices.includes(s.id)} onChange={() => toggleService(s.id)} /> <span>{isAddonService(s) ? '* ' : ''}{s.name} — {formatServicePrice(s)} • {s.duration_minutes || 0} min</span></label>)}
        </div>
        <p className="muted addon-disclaimer">Services marked with * must be added with a pedicure or manicure</p>
        {bookingFlowError === 'Please select a service from above.' && <p className="form-error" role="alert">{bookingFlowError}</p>}
        {serviceError && <p className="form-error" role="alert">{serviceError}</p>}
        {!!selected.length && <p className="muted">Estimated length: {duration} min. {startsAt ? `Estimated total starts at $${totalMin.toFixed(2)}` : `Estimated total is $${totalMin.toFixed(2)}`}</p>}
      </div>
      <div>
        {!serviceError && selectedServices.length > 0 && (
          <>
            <h3>2. Choose date</h3>
            <div className="calendar-nav" aria-label="Calendar month navigation">
              <button type="button" className="calendar-nav-button" onClick={() => changeCalendarMonth(-1)} disabled={isPreviousMonthDisabled} aria-label="Previous month">‹</button>
              <div className="calendar-month-label" aria-live="polite">{monthLabel}</div>
              <button type="button" className="calendar-nav-button" onClick={() => changeCalendarMonth(1)} disabled={isNextMonthDisabled} aria-label="Next month">›</button>
            </div>
            <div className="calendar-grid">
              {weekdayLabels.map((label) => <div key={label} className="calendar-header">{label}</div>)}
              {Array.from({ length: firstWeekday }).map((_, idx) => <div key={`empty-${idx}`} className="calendar-empty" aria-hidden="true" />)}
              {Array.from({ length: daysInMonth }).map((_, idx) => {
                const day = idx + 1;
                const isoDate = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const dayAvailability = availabilityMap.get(isoDate);
                const isAvailable = dayAvailability?.available;
                const isSelected = selectedDate === isoDate;
                const isToday = isoDate === todayIso;
                const isPast = isoDate < todayIso;
                const showToday = isToday && isAvailable && !isSelected && !isPast;

                return <button key={isoDate} className={`calendar-day ${isAvailable ? 'available' : 'unavailable'} ${isSelected ? 'selected' : ''} ${showToday ? 'today' : ''} ${isPast ? 'past' : ''}`} disabled={!isAvailable || isPast} onClick={() => { setBookingFlowError(''); setSubmitValidationError(''); setSelectedDate(isoDate); setSelectedTime(''); }}>{day}</button>;
              })}
            </div>
            {bookingFlowError === 'Please select an available date from above.' && <p className="form-error" role="alert">{bookingFlowError}</p>}
            {selectedDate && <div ref={timeRef} className="time-selection"><h3>3. Choose time</h3>{times.length > 0 ? <select ref={timeSelectRef} value={selectedTime} onChange={(e) => { setBookingFlowError(''); setSubmitValidationError(''); setSelectedTime(e.target.value); }}><option value="">Select a time</option>{times.map((t) => <option key={t} value={t}>{formatTime12Hour(t)}</option>)}</select> : <p className="muted">No remaining times are available for this date.</p>}{bookingFlowError === 'Please select an available time from above.' && <p className="form-error" role="alert">{bookingFlowError}</p>}</div>}
          </>
        )}
      </div>
    </div>
    <form onSubmit={submit} className="booking-form" noValidate>
      <h3>4. Your details</h3>
      <div className="split"><label>First name<input required value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} /></label><label>Last name<input required value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} /></label></div>
      <div className="split"><label>Phone<input required pattern="[0-9]{10}" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))} /></label><label>Email<input required type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></label></div>
      <label>Preferred notifications
        <select value={form.communicationPreference} onChange={(e) => setForm((f) => ({ ...f, communicationPreference: e.target.value }))}>
          <option value="both">SMS + Email</option>
          <option value="sms">SMS only</option>
          <option value="email">Email only</option>
        </select>
      </label>
      <label>Notes<textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></label>

      <h3>5. Payment information</h3>
      <div className="policy-box">
        {!showDevSquareTokenInput && (
          <>
            <p>Enter your card information securely below. Card details are tokenized by Square and never sent directly to our servers.</p>
            <SquareCardField ref={squareCardRef} onReadyStateChange={onSquareReadyStateChange} />
          </>
        )}
        {showDevSquareTokenInput && (
          <>
            <p className="muted"><strong>Developer-only mode:</strong> manual token input is enabled for local testing and should never be used as the default customer flow.</p>
            <label><strong>Developer-only Square token placeholder</strong><input required value={devSquareToken} onChange={(e) => setDevSquareToken(e.target.value.trim())} placeholder="Developer only: cnon:card-nonce-from-square" /></label>
          </>
        )}
        {cardError && <p className="form-error" role="alert">{cardError}</p>}
      </div>

      <div className="policy-box">
        <h4>Late, no-show, and cancellation policy</h4>
        <p>A valid credit or debit card is required to request an appointment. Your card will be securely stored on file and will not be charged at the time of booking. By submitting your appointment request, you authorize Nails by Brittney to charge your card only in the following situations:</p>
        <ul>
          <li>Late cancellation: If you cancel less than 24 hours before your scheduled appointment, you may be charged 25% of the estimated service total.</li>
          <li>No-show: If you miss your appointment without notice, you may be charged 50% of the estimated service total.</li>
        </ul>
        <p>Any service charges, late cancellation fees, or no-show fees are applied manually by Nails by Brittney. If a lesser amount is charged than the standard policy amount, it will be at Nails by Brittney’s discretion. By continuing, you acknowledge and agree to these terms.</p>
        <label className="service-check"><input type="checkbox" required checked={form.policyAcknowledged} onChange={(e) => setForm((f) => ({ ...f, policyAcknowledged: e.target.checked }))} /> I understand and agree to the card-on-file, late cancellation, and no-show policy.</label>
      </div>

      <button className="btn primary" disabled={busy}>{busy ? 'Submitting...' : 'Submit booking request'}</button>
      {submitValidationError && <p className="form-error submit-error" role="alert">{submitValidationError}</p>}
      {!showDevSquareTokenInput && !isSquareReady && <p className="muted">Secure card entry must finish loading before you can submit your booking request.</p>}
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

  return <><header className="sticky-nav"><div className="container nav-inner"><a href="#home" className="brand-mini">Nails by Brittney</a><button className="menu-toggle" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>Menu</button><nav className={`nav-links ${menuOpen ? 'open' : ''}`}>{navItems.map(([id, label]) => <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)}>{label}</a>)}</nav></div></header>
    <main>
      <section id="home" className="section hero"><div className="container hero-inner"><img src={logo} className="hero-logo" alt="Nails by Brittney logo" /><h1>Nails by Brittney</h1><p className="subtitle">Certified Nail Technician</p><div className="cta-row"><a href="#booking" className="btn primary">Book now</a><a href={`tel:${PHONE_LINK}`} className="btn">Call now</a><a href={INSTAGRAM_URL} target="_blank" rel="noreferrer" className="btn ghost">Instagram</a></div></div></section>
      <Divider />
      <section id="about" className="section about-section"><div className="container"><div><SectionHeading title="Brittney Prosser, Certified Nail Technician" eyebrow="About" /><p>{SAMPLE_BIO}</p></div></div></section>
      <Divider />
      <section id="examples" className="section alt"><div className="container"><h3>Testimonials</h3>{testimonials.map((item) => <blockquote key={item.id}>"{item.quote}" <span>- {item.customer}</span></blockquote>)}<h3>Gallery</h3><GalleryCarousel items={gallery} />{!hasImages && <p className="muted">Upload images in admin.</p>}</div></section>
      <Divider />
      <section id="services" className="section"><div className="container"><SectionHeading title="Services and Pricing" eyebrow="Signature Menu" /><div className="service-grid">{services.map((service) => <article key={service.id} className="card"><h3>{service.name}</h3><p className="meta">{formatServicePrice(service)} • {service.duration || `${service.duration_minutes} min`}</p><p>{service.description}</p></article>)}</div></div></section>
      <Divider />
      <BookingSection services={services} />
      <Divider />
      <section id="contact" className="section alt"><div className="container"><SectionHeading title="Contact" eyebrow="Get in Touch" /><p className="contact-blurb"><strong>Phone:</strong> {PHONE_DISPLAY} (call or text)<br /><strong>Email:</strong> {EMAIL}<br /><strong>Instagram:</strong> <a href={INSTAGRAM_URL} target="_blank" rel="noreferrer">Instagram</a></p></div></section>
      <Divider />
      <section id="location" className="section"><div className="container split"><div><SectionHeading title="Location" eyebrow="Visit" /><p>Brittney Prosser at "Bronzed and Polished"<br />139 Eastview Dr<br />Emerald Isle NC 28594<br />{PHONE_DISPLAY}<br />{EMAIL}</p></div><div className="map-shell"><iframe title="Map" className="map" loading="lazy" src="https://www.google.com/maps?q=139%20Eastview%20Dr%2C%20Emerald%20Isle%20NC%2028594&output=embed" /></div></div></section>
      <footer className="footer" role="contentinfo"><div className="container"><p>Nails by Brittney</p><p>{PHONE_DISPLAY} • {EMAIL}</p><p>Designed, hosted, and managed by <a href="https://www.adk-digital.com" target="_blank" rel="noreferrer">ADK Digital</a></p></div></footer>
    </main>
  </>;
}
