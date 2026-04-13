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
import { hasSupabaseConfig, supabase } from '../lib/supabase';

async function compressImage(file) {
  const bitmap = await createImageBitmap(file);
  const maxWidth = 1800;
  const ratio = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })), 'image/jpeg', 0.82));
}

function DraggableList({ items, setItems, table, renderFields }) {
  const move = async (from, to) => {
    const clone = [...items];
    const [item] = clone.splice(from, 1);
    clone.splice(to, 0, item);
    const reordered = clone.map((entry, idx) => ({ ...entry, display_order: idx + 1 }));
    setItems(reordered);
    if (hasSupabaseConfig) await updateOrder(table, reordered);
  };

  return (
    <ul>
      {items.map((item, idx) => (
        <li key={item.id} className="admin-item" draggable onDragStart={(e) => e.dataTransfer.setData('text/id', item.id)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
          const sourceId = e.dataTransfer.getData('text/id');
          const sourceIndex = items.findIndex((x) => x.id === sourceId);
          move(sourceIndex, idx);
        }}>
          <div className="reorder-buttons"><button onClick={() => idx > 0 && move(idx, idx - 1)}>↑</button><button onClick={() => idx < items.length - 1 && move(idx, idx + 1)}>↓</button></div>
          {renderFields(item)}
        </li>
      ))}
    </ul>
  );
}

export default function AdminPage() {
  const [session, setSession] = useState(null);
  const [services, setServices] = useState([]);
  const [testimonials, setTestimonials] = useState([]);
  const [gallery, setGallery] = useState([]);

  useEffect(() => {
    if (!hasSupabaseConfig) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_evt, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    Promise.all([fetchServices(), fetchTestimonials(), fetchGalleryItems()]).then(([s, t, g]) => {
      setServices(s);
      setTestimonials(t);
      setGallery(g);
    });
  }, []);

  const signedIn = useMemo(() => (!hasSupabaseConfig ? true : Boolean(session)), [session]);
  const signIn = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await supabase.auth.signInWithPassword({ email: fd.get('email'), password: fd.get('password') });
  };

  if (!signedIn) return <main className="admin-wrap"><h1>Admin Login</h1><form onSubmit={signIn} className="admin-form"><label>Email<input name="email" type="email" required /></label><label>Password<input name="password" type="password" required /></label><button className="btn primary" type="submit">Sign in</button></form></main>;

  return (
    <main className="admin-wrap">
      <h1>Nails by Brittney Admin</h1>
      {hasSupabaseConfig && <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>}

      <section>
        <h2>Testimonials</h2>
        <button className="btn" onClick={async () => {
          const item = { customer: 'Customer Name', quote: 'Editable testimonial quote.', display_order: testimonials.length + 1 };
          const created = hasSupabaseConfig ? await createRecord('testimonials', item) : { ...item, id: crypto.randomUUID() };
          setTestimonials((p) => [...p, created]);
        }}>Add Testimonial</button>
        <DraggableList items={testimonials} setItems={setTestimonials} table="testimonials" renderFields={(t) => <><input value={t.customer} onChange={(e) => setTestimonials((p) => p.map((i) => i.id === t.id ? { ...i, customer: e.target.value } : i))} /><textarea value={t.quote} onChange={(e) => setTestimonials((p) => p.map((i) => i.id === t.id ? { ...i, quote: e.target.value } : i))} /><button onClick={async () => hasSupabaseConfig && updateRecord('testimonials', t.id, { customer: t.customer, quote: t.quote })}>Save</button><button onClick={async () => { if (hasSupabaseConfig) await deleteRecord('testimonials', t.id); setTestimonials((p) => p.filter((i) => i.id !== t.id)); }}>Delete</button></>} />
      </section>

      <section>
        <h2>Services</h2>
        <button className="btn" onClick={async () => {
          const item = { name: 'New Service', price_text: '$0', duration: '30 min', description: 'Service details', display_order: services.length + 1 };
          const created = hasSupabaseConfig ? await createRecord('services', item) : { ...item, id: crypto.randomUUID() };
          setServices((p) => [...p, created]);
        }}>Add Service</button>
        <DraggableList items={services} setItems={setServices} table="services" renderFields={(s) => <><input value={s.name} onChange={(e) => setServices((p) => p.map((i) => i.id === s.id ? { ...i, name: e.target.value } : i))} /><input value={s.price_text} onChange={(e) => setServices((p) => p.map((i) => i.id === s.id ? { ...i, price_text: e.target.value } : i))} /><input value={s.duration} onChange={(e) => setServices((p) => p.map((i) => i.id === s.id ? { ...i, duration: e.target.value } : i))} /><textarea value={s.description} onChange={(e) => setServices((p) => p.map((i) => i.id === s.id ? { ...i, description: e.target.value } : i))} /><button onClick={async () => hasSupabaseConfig && updateRecord('services', s.id, { name: s.name, price_text: s.price_text, duration: s.duration, description: s.description })}>Save</button><button onClick={async () => { if (hasSupabaseConfig) await deleteRecord('services', s.id); setServices((p) => p.filter((i) => i.id !== s.id)); }}>Delete</button></>} />
      </section>

      <section>
        <h2>Gallery</h2>
        <input type="file" accept="image/*" multiple onChange={async (e) => {
          const files = Array.from(e.target.files || []);
          for (const file of files) {
            const compressed = await compressImage(file);
            const storageKey = `gallery/${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`;
            let created;
            if (hasSupabaseConfig) {
              await uploadGalleryImage(compressed, storageKey);
              created = await createRecord('gallery_items', { storage_key: storageKey, caption: '', display_order: gallery.length + 1 });
              const { data } = supabase.storage.from(import.meta.env.VITE_SUPABASE_GALLERY_BUCKET || 'gallery').getPublicUrl(storageKey);
              created = { ...created, imageUrl: data.publicUrl };
            } else {
              created = { id: crypto.randomUUID(), storage_key: storageKey, caption: '', display_order: gallery.length + 1, imageUrl: URL.createObjectURL(file) };
            }
            setGallery((p) => [...p, created]);
          }
        }} />
        <DraggableList items={gallery} setItems={setGallery} table="gallery_items" renderFields={(g) => <div className="gallery-admin-item">{(g.imageUrl || g.local_path) ? <img src={g.imageUrl || g.local_path} alt="Gallery" /> : <div className="missing-image">No image</div>}<input placeholder="Caption (optional)" value={g.caption || ''} onChange={(e) => setGallery((p) => p.map((i) => i.id === g.id ? { ...i, caption: e.target.value } : i))} /><button onClick={async () => hasSupabaseConfig && updateRecord('gallery_items', g.id, { caption: g.caption || '' })}>Save</button><button className="danger" onClick={async () => { if (hasSupabaseConfig) { await deleteGalleryImage(g.storage_key); await deleteRecord('gallery_items', g.id); } setGallery((p) => p.filter((i) => i.id !== g.id)); }}>Delete</button></div>} />
      </section>
      {!hasSupabaseConfig && <p className="muted">Supabase credentials are not configured. Admin is running in local demo mode.</p>}
    </main>
  );
}
