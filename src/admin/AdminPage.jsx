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
import { createBlockedTime, deleteBlockedTime, fetchAdminAppointments, setAppointmentStatus } from '../lib/bookingApi';
import { hasSupabaseConfig, supabase } from '../lib/supabase';

function DraggableList({ items, setItems, table, renderFields }) { return <ul>{items.map((item, idx) => <li key={item.id} className="admin-item">{renderFields(item, idx)}</li>)}</ul>; }

export default function AdminPage() {
  const [session, setSession] = useState(null);
  const [services, setServices] = useState([]);
  const [testimonials, setTestimonials] = useState([]);
  const [gallery, setGallery] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [blockedTimes, setBlockedTimes] = useState([]);

  const refreshBookingAdmin = async () => {
    const data = await fetchAdminAppointments();
    setAppointments(data.appointments || []);
    setCustomers(data.customers || []);
    setBlockedTimes(data.blockedTimes || []);
  };

  useEffect(() => {
    if (!hasSupabaseConfig) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_evt, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    Promise.all([fetchServices(), fetchTestimonials(), fetchGalleryItems()]).then(([s, t, g]) => {
      setServices(s); setTestimonials(t); setGallery(g);
    });
    refreshBookingAdmin();
  }, []);

  const signedIn = useMemo(() => (!hasSupabaseConfig ? true : Boolean(session)), [session]);
  const signIn = async (e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); await supabase.auth.signInWithPassword({ email: fd.get('email'), password: fd.get('password') }); };

  if (!signedIn) return <main className="admin-wrap"><h1>Admin Login</h1><form onSubmit={signIn} className="admin-form"><label>Email<input name="email" type="email" required /></label><label>Password<input name="password" type="password" required /></label><button className="btn primary" type="submit">Sign in</button></form></main>;

  return <main className="admin-wrap"><h1>Nails by Brittney Admin</h1>
    {hasSupabaseConfig && <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>}

    <section><h2>Appointments</h2><button className="btn" onClick={refreshBookingAdmin}>Refresh</button>
      <div className="admin-list">{appointments.map((a) => <article key={a.id} className="card"><strong>#{a.booking_request_number}</strong> {a.customers?.first_name} {a.customers?.last_name}<br />{new Date(a.start_at).toLocaleString()} - {a.status}
        <div className="cta-row">
          {['confirmed', 'declined', 'cancelled', 'completed', 'no_show'].map((status) => <button key={status} className="btn" onClick={async () => { await setAppointmentStatus(a.id, status); refreshBookingAdmin(); }}>{status}</button>)}
        </div></article>)}</div>
    </section>

    <section><h2>Blocked Times</h2>
      <button className="btn" onClick={async () => {
        const startAt = prompt('Start ISO datetime (e.g. 2026-04-17T16:00:00Z)');
        const endAt = prompt('End ISO datetime (e.g. 2026-04-17T18:00:00Z)');
        if (!startAt || !endAt) return;
        await createBlockedTime({ startAt, endAt, reason: 'Admin block' });
        refreshBookingAdmin();
      }}>Add Block</button>
      {blockedTimes.map((b) => <div key={b.id}>{new Date(b.start_at).toLocaleString()} - {new Date(b.end_at).toLocaleString()} ({b.reason}) <button onClick={async () => { await deleteBlockedTime(b.id); refreshBookingAdmin(); }}>Delete</button></div>)}
    </section>

    <section><h2>Customers</h2>{customers.map((c) => <article key={c.id} className="card"><h4>{c.first_name} {c.last_name}</h4><p>{c.phone} • {c.email}</p><ul>{(c.customer_notes || []).map((n) => <li key={n.id}>{new Date(n.created_at).toLocaleDateString()} - {n.note_text}</li>)}</ul></article>)}</section>

    <section><h2>Testimonials</h2><button className="btn" onClick={async () => { const item = { customer: 'Customer Name', quote: 'Editable testimonial quote.', display_order: testimonials.length + 1 }; const created = hasSupabaseConfig ? await createRecord('testimonials', item) : { ...item, id: crypto.randomUUID() }; setTestimonials((p) => [...p, created]); }}>Add Testimonial</button>
      <DraggableList items={testimonials} setItems={setTestimonials} table="testimonials" renderFields={(t) => <><input value={t.customer} onChange={(e) => setTestimonials((p) => p.map((i) => i.id === t.id ? { ...i, customer: e.target.value } : i))} /><textarea value={t.quote} onChange={(e) => setTestimonials((p) => p.map((i) => i.id === t.id ? { ...i, quote: e.target.value } : i))} /><button onClick={async () => hasSupabaseConfig && updateRecord('testimonials', t.id, { customer: t.customer, quote: t.quote })}>Save</button><button onClick={async () => { if (hasSupabaseConfig) await deleteRecord('testimonials', t.id); setTestimonials((p) => p.filter((i) => i.id !== t.id)); }}>Delete</button></>} />
    </section>

    <section><h2>Services</h2><button className="btn" onClick={async () => {
      const item = { name: 'New Service', price_text: '$0', price_min_numeric: 0, duration: '30 min', duration_minutes: 30, is_variable_price: false, description: 'Service details', display_order: services.length + 1, active: true };
      const created = hasSupabaseConfig ? await createRecord('services', item) : { ...item, id: crypto.randomUUID() };
      setServices((p) => [...p, created]);
    }}>Add Service</button>
      <DraggableList items={services} setItems={setServices} table="services" renderFields={(s, idx) => <><input value={s.name} onChange={(e) => setServices((p) => p.map((i) => i.id === s.id ? { ...i, name: e.target.value } : i))} /><input value={s.price_text} onChange={(e) => setServices((p) => p.map((i) => i.id === s.id ? { ...i, price_text: e.target.value } : i))} /><input type="number" value={s.price_min_numeric || 0} onChange={(e) => setServices((p) => p.map((i) => i.id === s.id ? { ...i, price_min_numeric: Number(e.target.value) } : i))} /><input type="number" value={s.duration_minutes || 0} onChange={(e) => setServices((p) => p.map((i) => i.id === s.id ? { ...i, duration_minutes: Number(e.target.value), duration: `${e.target.value} min` } : i))} /><label><input type="checkbox" checked={Boolean(s.is_variable_price)} onChange={(e) => setServices((p) => p.map((i) => i.id === s.id ? { ...i, is_variable_price: e.target.checked } : i))} /> Variable price</label><textarea value={s.description} onChange={(e) => setServices((p) => p.map((i) => i.id === s.id ? { ...i, description: e.target.value } : i))} /><button onClick={async () => hasSupabaseConfig && updateRecord('services', s.id, { name: s.name, price_text: s.price_text, price_min_numeric: s.price_min_numeric, duration: `${s.duration_minutes} min`, duration_minutes: s.duration_minutes, is_variable_price: s.is_variable_price, description: s.description, display_order: idx + 1 })}>Save</button><button onClick={async () => { if (hasSupabaseConfig) await deleteRecord('services', s.id); setServices((p) => p.filter((i) => i.id !== s.id)); }}>Delete</button><button onClick={async () => hasSupabaseConfig && updateOrder('services', services)}>Save Order</button></>} />
    </section>

    <section><h2>Gallery</h2><input type="file" accept="image/*" multiple onChange={async (e) => {
      const files = Array.from(e.target.files || []);
      for (const file of files) {
        const storageKey = `gallery/${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`;
        let created;
        if (hasSupabaseConfig) {
          await uploadGalleryImage(file, storageKey);
          created = await createRecord('gallery_items', { storage_key: storageKey, caption: '', display_order: gallery.length + 1 });
          const { data } = supabase.storage.from(import.meta.env.VITE_SUPABASE_GALLERY_BUCKET || 'gallery').getPublicUrl(storageKey);
          created = { ...created, imageUrl: data.publicUrl };
        } else {
          created = { id: crypto.randomUUID(), storage_key: storageKey, caption: '', display_order: gallery.length + 1, imageUrl: URL.createObjectURL(file) };
        }
        setGallery((p) => [...p, created]);
      }
    }} />
      <DraggableList items={gallery} setItems={setGallery} table="gallery_items" renderFields={(g) => <div className="gallery-admin-item">{(g.imageUrl || g.local_path) ? <img src={g.imageUrl || g.local_path} alt="Gallery" /> : <div className="missing-image">No image</div>}<input placeholder="Caption" value={g.caption || ''} onChange={(e) => setGallery((p) => p.map((i) => i.id === g.id ? { ...i, caption: e.target.value } : i))} /><button onClick={async () => hasSupabaseConfig && updateRecord('gallery_items', g.id, { caption: g.caption || '' })}>Save</button><button className="danger" onClick={async () => { if (hasSupabaseConfig) { await deleteGalleryImage(g.storage_key); await deleteRecord('gallery_items', g.id); } setGallery((p) => p.filter((i) => i.id !== g.id)); }}>Delete</button></div>} />
    </section>
  </main>;
}
