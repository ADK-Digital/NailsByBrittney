import { GALLERY_BUCKET, hasSupabaseConfig, supabase } from './supabase';
import { SAMPLE_GALLERY, SAMPLE_SERVICES, SAMPLE_TESTIMONIALS } from './constants';

const withLocalFallback = (item) => {
  const match = item.storage_key?.match(/image(\d+)\.jpeg$/i);
  const localPath = match ? `/images/image${match[1]}.jpeg` : item.local_path || null;
  return { ...item, local_path: localPath };
};

const mapGalleryWithUrls = (items) =>
  items.map((item) => {
    const { data } = supabase.storage.from(GALLERY_BUCKET).getPublicUrl(item.storage_key);
    return withLocalFallback({ ...item, imageUrl: data.publicUrl });
  });

export async function fetchServices({ includeInactive = false } = {}) {
  if (!hasSupabaseConfig) return includeInactive ? SAMPLE_SERVICES : SAMPLE_SERVICES.filter((service) => service.active !== false);
  let query = supabase.from('services').select('*').order('display_order', { ascending: true });
  if (!includeInactive) query = query.eq('active', true);
  const { data, error } = await query;
  if (error) {
    console.error('Failed to fetch services from Supabase:', error);
    return [];
  }
  return (data || []).map((item) => ({ ...item, duration: item.duration || `${item.duration_minutes} min` }));
}

export async function fetchTestimonials() {
  if (!hasSupabaseConfig) return SAMPLE_TESTIMONIALS;
  const { data, error } = await supabase.from('testimonials').select('*').order('display_order', { ascending: true });
  if (error || !data?.length) return SAMPLE_TESTIMONIALS;
  return data;
}

export async function fetchGalleryItems() {
  if (!hasSupabaseConfig) return SAMPLE_GALLERY.map((i) => withLocalFallback({ ...i, imageUrl: null }));
  const { data, error } = await supabase.from('gallery_items').select('*').order('display_order', { ascending: true });
  if (error) {
    console.error('Failed to fetch gallery items from Supabase:', error);
    return [];
  }
  if (!data?.length) return [];
  return mapGalleryWithUrls(data.filter((item) => !item.storage_key?.toLowerCase().includes('logo')));
}

export async function updateOrder(table, items) {
  const updates = items.map((item, index) => ({ id: item.id, display_order: index + 1 }));
  for (const update of updates) {
    // eslint-disable-next-line no-await-in-loop
    await supabase.from(table).update({ display_order: update.display_order }).eq('id', update.id);
  }
}

export async function createRecord(table, payload) {
  const { data, error } = await supabase.from(table).insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateRecord(table, id, payload) {
  const { data, error } = await supabase.from(table).update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteRecord(table, id) {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
}

export async function uploadGalleryImage(file, storageKey) {
  const { error } = await supabase.storage.from(GALLERY_BUCKET).upload(storageKey, file, { upsert: true });
  if (error) throw error;
}

export async function deleteGalleryImage(storageKey) {
  const { error } = await supabase.storage.from(GALLERY_BUCKET).remove([storageKey]);
  if (error) throw error;
}
