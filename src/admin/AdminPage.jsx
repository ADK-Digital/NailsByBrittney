import { useEffect, useMemo, useState } from 'react';
import {
  createRecord,
  deleteGalleryImage,
  deleteRecord,
  fetchGalleryItems,
  fetchServices,
  fetchTestimonials,
  updateOrder,
  updateRecord,
  uploadGalleryImage,
} from '../lib/api';
import {
  adminChargeAppointment,
  adminRefundAppointment,
  createBlockedTime,
  deleteBlockedTime,
  fetchAdminAppointments,
  setAppointmentStatus,
} from '../lib/bookingApi';
import { hasSupabaseConfig, supabase } from '../lib/supabase';

function DraggableList({ items, renderFields }) { return <ul className="admin-edit-list">{items.map((item, idx) => <li key={item.id} className="admin-item">{renderFields(item, idx)}</li>)}</ul>; }

function formatAdminStatus(status) {
  return String(status || 'unknown').replace(/_/g, ' ');
}

function statusClassName(status) {
  return `pill status-pill status-${String(status || 'unknown').replace(/_/g, '-')}`;
}

function AdminSecondaryButton({ className = '', ...props }) {
  return <button type="button" className={`admin-secondary-button${className ? ` ${className}` : ''}`} {...props} />;
}

function AppointmentCard({ appointment, onRefresh }) {
  const [serviceAmount, setServiceAmount] = useState('');
  const [latePct, setLatePct] = useState('25');
  const [noShowPct, setNoShowPct] = useState('50');
  const [refundPct, setRefundPct] = useState('50');

  const events = appointment.appointment_financial_events || [];
  const sortedEvents = [...events].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const call = async (fn) => { await fn(); await onRefresh(); };

  return <article className="card appointment-card">
    <div className="appointment-head">
      <div className="appointment-title">
        <span className="appointment-label">Booking</span>
        <strong>#{appointment.booking_request_number}</strong>
      </div>
      <div className="appointment-meta" aria-label="Booking status details">
        <span className={statusClassName(appointment.status)}><span>Status</span>{formatAdminStatus(appointment.status)}</span>
        <span className="pill meta-pill"><span>Service payment</span>{appointment.service_payment_status || 'unpaid'}</span>
        <span className="pill meta-pill"><span>Late fee</span>{appointment.late_fee_status || 'unpaid'}</span>
        <span className="pill meta-pill"><span>No-show fee</span>{appointment.no_show_fee_status || 'unpaid'}</span>
      </div>
    </div>
    <p><strong>{appointment.customers?.first_name} {appointment.customers?.last_name}</strong> • {new Date(appointment.start_at).toLocaleString()}</p>
    <p className="muted">Comm pref: {appointment.customers?.communication_preference || 'both'} • Card: {appointment.customers?.card_on_file_status || 'missing'} {appointment.customers?.card_brand ? `(${appointment.customers.card_brand} ••••${appointment.customers.card_last4 || ''})` : ''}</p>

    <div className="admin-action-grid">
      {['confirmed', 'declined', 'cancelled', 'completed', 'no_show'].map((status) => <button key={status} className="btn" onClick={() => call(() => setAppointmentStatus(appointment.id, status))}>{formatAdminStatus(status)}</button>)}
    </div>

    <div className="admin-action-grid">
      <button className="btn" onClick={() => call(() => adminChargeAppointment({ appointmentId: appointment.id, target: 'late', percent: Number(latePct || 25) }))}>Charge late fee</button>
      <input value={latePct} onChange={(e) => setLatePct(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="25" />
      <button className="btn" onClick={() => call(() => adminChargeAppointment({ appointmentId: appointment.id, target: 'no_show', percent: Number(noShowPct || 50) }))}>Charge no-show fee</button>
      <input value={noShowPct} onChange={(e) => setNoShowPct(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="50" />
      <button className="btn" onClick={() => call(() => adminChargeAppointment({ appointmentId: appointment.id, target: 'service', amount: Number(serviceAmount || 0) }))}>Charge services</button>
      <input
        value={serviceAmount}
        onChange={(e) => setServiceAmount(e.target.value.replace(/[^0-9.]/g, ''))}
        placeholder="Type service amount (e.g. 85.00)"
      />
    </div>

    <div className="admin-action-grid">
      <button className="btn" onClick={() => call(() => adminRefundAppointment({ appointmentId: appointment.id, target: 'late' }))}>Refund late fee</button>
      <button className="btn" onClick={() => call(() => adminRefundAppointment({ appointmentId: appointment.id, target: 'no_show' }))}>Refund no-show fee</button>
      <button className="btn" onClick={() => call(() => adminRefundAppointment({ appointmentId: appointment.id, target: 'service' }))}>Refund services full</button>
      <button className="btn" onClick={() => call(() => adminRefundAppointment({ appointmentId: appointment.id, target: 'service', percent: Number(refundPct || 50) }))}>Refund services %</button>
      <input value={refundPct} onChange={(e) => setRefundPct(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="50" />
    </div>

    {!!sortedEvents.length && <details><summary>Payment history ({sortedEvents.length})</summary><ul>{sortedEvents.map((event) => <li key={event.id}>{new Date(event.created_at).toLocaleString()} • {event.event_type} • ${(Number(event.amount_cents || 0) / 100).toFixed(2)} • {event.status} • {event.initiated_by}</li>)}</ul></details>}
  </article>;
}

export default function AdminPage() {
  const [session, setSession] = useState(null);
  const [services, setServices] = useState([]);
  const [testimonials, setTestimonials] = useState([]);
  const [gallery, setGallery] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [blockedTimes, setBlockedTimes] = useState([]);
  const [selectedGalleryFiles, setSelectedGalleryFiles] = useState([]);
  const [galleryCaptionDraft, setGalleryCaptionDraft] = useState('');
  const [galleryUploadBusy, setGalleryUploadBusy] = useState(false);
  const [galleryMessage, setGalleryMessage] = useState({ type: '', text: '' });

  const refreshBookingAdmin = async () => {
    const data = await fetchAdminAppointments();
    setAppointments(data.appointments || []);
    setCustomers(data.customers || []);
    setBlockedTimes(data.blockedTimes || []);
  };

  const refreshServiceList = async () => setServices(await fetchServices());
  const refreshGalleryList = async () => setGallery(await fetchGalleryItems());

  useEffect(() => {
    if (!hasSupabaseConfig) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_evt, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    Promise.all([fetchServices(), fetchTestimonials(), fetchGalleryItems()]).then(([serviceData, testimonialData, galleryData]) => {
      setServices(serviceData);
      setTestimonials(testimonialData);
      setGallery(galleryData);
    });
    refreshBookingAdmin();
  }, []);

  const signedIn = useMemo(() => (!hasSupabaseConfig ? true : Boolean(session)), [session]);
  const signIn = async (e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); await supabase.auth.signInWithPassword({ email: fd.get('email'), password: fd.get('password') }); };

  const uploadSelectedGalleryPhotos = async () => {
    if (!selectedGalleryFiles.length) return setGalleryMessage({ type: 'error', text: 'Please choose at least one photo to upload.' });
    if (!hasSupabaseConfig) {
      const mockRows = selectedGalleryFiles.map((file, index) => ({ id: crypto.randomUUID(), storage_key: `local/${Date.now()}-${index}-${file.name}`, caption: galleryCaptionDraft.trim(), display_order: gallery.length + index + 1, imageUrl: URL.createObjectURL(file) }));
      setGallery((prev) => [...prev, ...mockRows]);
      setSelectedGalleryFiles([]);
      setGalleryCaptionDraft('');
      setGalleryMessage({ type: 'success', text: `Added ${mockRows.length} local sample photo(s).` });
      return;
    }

    setGalleryUploadBusy(true);
    setGalleryMessage({ type: '', text: '' });
    try {
      const existing = await fetchGalleryItems();
      const baseDisplayOrder = existing.reduce((max, item) => Math.max(max, Number(item.display_order || 0)), 0);
      for (const [index, file] of selectedGalleryFiles.entries()) {
        const extension = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : 'jpg';
        const storageKey = `uploads/${Date.now()}-${crypto.randomUUID()}.${extension || 'jpg'}`;
        // eslint-disable-next-line no-await-in-loop
        await uploadGalleryImage(file, storageKey);
        // eslint-disable-next-line no-await-in-loop
        await createRecord('gallery_items', { storage_key: storageKey, caption: galleryCaptionDraft.trim(), display_order: baseDisplayOrder + index + 1 });
      }
      await refreshGalleryList();
      setSelectedGalleryFiles([]);
      setGalleryCaptionDraft('');
      setGalleryMessage({ type: 'success', text: `Uploaded ${selectedGalleryFiles.length} photo(s) successfully.` });
    } catch (error) {
      setGalleryMessage({ type: 'error', text: error?.message || 'Upload failed. Please try again.' });
    } finally {
      setGalleryUploadBusy(false);
    }
  };

  if (!signedIn) return <main className="admin-wrap"><h1>Admin Login</h1><form onSubmit={signIn} className="admin-form"><label>Email<input name="email" type="email" required /></label><label>Password<input name="password" type="password" required /></label><button className="btn primary" type="submit">Sign in</button></form></main>;

  return <main className="admin-wrap"><h1>Nails by Brittney Admin</h1>
    {hasSupabaseConfig && <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>}

    <section className="admin-section admin-section-appointments"><h2>Appointments</h2><button className="btn" onClick={refreshBookingAdmin}>Refresh</button>
      <div className="admin-list">{appointments.map((a) => <AppointmentCard key={a.id} appointment={a} onRefresh={refreshBookingAdmin} />)}</div>
    </section>

    <section className="admin-section"><h2>Blocked Times</h2><button className="btn" onClick={async () => {
      const startAt = prompt('Start ISO datetime (e.g. 2026-04-17T16:00:00Z)');
      const endAt = prompt('End ISO datetime (e.g. 2026-04-17T18:00:00Z)');
      if (!startAt || !endAt) return;
      await createBlockedTime({ startAt, endAt, reason: 'Admin block' });
      refreshBookingAdmin();
    }}>Add Block</button>{blockedTimes.map((b) => <div key={b.id}>{new Date(b.start_at).toLocaleString()} - {new Date(b.end_at).toLocaleString()} ({b.reason}) <AdminSecondaryButton onClick={async () => { await deleteBlockedTime(b.id); refreshBookingAdmin(); }}>Delete</AdminSecondaryButton></div>)}</section>

    <section className="admin-section admin-section-customers"><h2>Customers</h2><div className="admin-card-grid">{customers.map((c) => <article key={c.id} className="card customer-card"><h4>{c.first_name} {c.last_name}</h4><p>{c.phone} • {c.email} • pref: {c.communication_preference || 'both'}</p><p>Card: {c.card_on_file_status || 'missing'} {c.card_brand ? `(${c.card_brand} ••••${c.card_last4 || ''})` : ''}</p><ul>{(c.customer_notes || []).map((n) => <li key={n.id}>{new Date(n.created_at).toLocaleDateString()} - {n.note_text}</li>)}</ul></article>)}</div></section>

    <section className="admin-section admin-section-testimonials"><h2>Testimonials</h2><button className="btn" onClick={async () => { const item = { customer: 'Customer Name', quote: 'Editable testimonial quote.', display_order: testimonials.length + 1 }; const created = hasSupabaseConfig ? await createRecord('testimonials', item) : { ...item, id: crypto.randomUUID() }; setTestimonials((p) => [...p, created]); }}>Add Testimonial</button>
      <DraggableList items={testimonials} renderFields={(t) => <><input value={t.customer} onChange={(e) => setTestimonials((p) => p.map((i) => i.id === t.id ? { ...i, customer: e.target.value } : i))} /><textarea value={t.quote} onChange={(e) => setTestimonials((p) => p.map((i) => i.id === t.id ? { ...i, quote: e.target.value } : i))} /><AdminSecondaryButton onClick={async () => hasSupabaseConfig && updateRecord('testimonials', t.id, { customer: t.customer, quote: t.quote })}>Save</AdminSecondaryButton><AdminSecondaryButton className="danger" onClick={async () => { if (hasSupabaseConfig) await deleteRecord('testimonials', t.id); setTestimonials((p) => p.filter((i) => i.id !== t.id)); }}>Delete</AdminSecondaryButton></>} />
    </section>

    <section className="admin-section admin-section-services"><h2>Services</h2><button className="btn" onClick={async () => {
      const item = { name: 'New Service', price_text: '$0', price_min_numeric: 0, duration: '30 min', duration_minutes: 30, is_variable_price: false, description: 'Service details', type: 'base', requires_service_ids: [], display_order: services.length + 1, active: true };
      const created = hasSupabaseConfig ? await createRecord('services', item) : { ...item, id: crypto.randomUUID() };
      if (hasSupabaseConfig) await refreshServiceList(); else setServices((p) => [...p, created]);
    }}>Add Service</button>
      <DraggableList items={services} renderFields={(s, idx) => <><label>Service name<input value={s.name} onChange={(e) => setServices((p) => p.map((i) => i.id === s.id ? { ...i, name: e.target.value } : i))} /></label><label>Price (display)<input value={s.price_text} onChange={(e) => setServices((p) => p.map((i) => i.id === s.id ? { ...i, price_text: e.target.value } : i))} /></label><label>Base Price for Estimates<input type="number" value={s.price_min_numeric || 0} onChange={(e) => setServices((p) => p.map((i) => i.id === s.id ? { ...i, price_min_numeric: Number(e.target.value) } : i))} /></label><label>Duration (minutes)<input type="number" value={s.duration_minutes || 0} onChange={(e) => setServices((p) => p.map((i) => i.id === s.id ? { ...i, duration_minutes: Number(e.target.value), duration: `${e.target.value} min` } : i))} /></label><label><input type="checkbox" checked={Boolean(s.is_variable_price)} onChange={(e) => setServices((p) => p.map((i) => i.id === s.id ? { ...i, is_variable_price: e.target.checked } : i))} /> Variable price</label><label>Description<textarea value={s.description} onChange={(e) => setServices((p) => p.map((i) => i.id === s.id ? { ...i, description: e.target.value } : i))} /></label><AdminSecondaryButton onClick={async () => { if (!hasSupabaseConfig) return; await updateRecord('services', s.id, { name: s.name, price_text: s.price_text, price_min_numeric: s.price_min_numeric, duration: `${s.duration_minutes} min`, duration_minutes: s.duration_minutes, is_variable_price: s.is_variable_price, description: s.description, type: s.type || 'base', requires_service_ids: s.requires_service_ids || [], display_order: idx + 1 }); await refreshServiceList(); }}>Save</AdminSecondaryButton><AdminSecondaryButton className="danger" onClick={async () => { if (hasSupabaseConfig) { await deleteRecord('services', s.id); await refreshServiceList(); return; } setServices((p) => p.filter((i) => i.id !== s.id)); }}>Delete</AdminSecondaryButton><AdminSecondaryButton onClick={async () => { if (!hasSupabaseConfig) return; await updateOrder('services', services); await refreshServiceList(); }}>Save Order</AdminSecondaryButton></>} />
    </section>

    <section className="admin-section admin-section-gallery"><h2>Gallery</h2><div className="gallery-upload-panel"><label htmlFor="gallery-file-picker">Select photo(s) to upload</label><input id="gallery-file-picker" type="file" accept="image/*" multiple onChange={(e) => { setSelectedGalleryFiles(Array.from(e.target.files || [])); setGalleryMessage({ type: '', text: '' }); }} /><label htmlFor="gallery-caption-input">Caption (optional)</label><input id="gallery-caption-input" placeholder="Caption for selected photo(s)" value={galleryCaptionDraft} onChange={(e) => setGalleryCaptionDraft(e.target.value)} /><button className="btn primary" onClick={uploadSelectedGalleryPhotos} disabled={galleryUploadBusy}>{galleryUploadBusy ? 'Uploading...' : 'Upload Selected Photos'}</button>{!!selectedGalleryFiles.length && <p className="muted">{selectedGalleryFiles.length} file(s) selected.</p>}{!!galleryMessage.text && <p className={galleryMessage.type === 'error' ? 'admin-message error' : 'admin-message success'}>{galleryMessage.text}</p>}</div>
      <DraggableList items={gallery} renderFields={(g) => <div className="gallery-admin-item">{(g.imageUrl || g.local_path) ? <img src={g.imageUrl || g.local_path} alt="Gallery" /> : <div className="missing-image">No image</div>}<input placeholder="Caption" value={g.caption || ''} onChange={(e) => setGallery((p) => p.map((i) => i.id === g.id ? { ...i, caption: e.target.value } : i))} /><AdminSecondaryButton onClick={async () => { if (!hasSupabaseConfig) return; await updateRecord('gallery_items', g.id, { caption: g.caption || '' }); await refreshGalleryList(); }}>Save</AdminSecondaryButton><AdminSecondaryButton className="danger" onClick={async () => { if (hasSupabaseConfig) { await deleteGalleryImage(g.storage_key); await deleteRecord('gallery_items', g.id); await refreshGalleryList(); return; } setGallery((p) => p.filter((i) => i.id !== g.id)); }}>Delete</AdminSecondaryButton></div>} />
      <AdminSecondaryButton onClick={async () => { if (!hasSupabaseConfig) return; await updateOrder('gallery_items', gallery); await refreshGalleryList(); }}>Save Gallery Order</AdminSecondaryButton>
    </section>
  </main>;
}
