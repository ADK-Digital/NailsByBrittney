import { GALLERY_BUCKET, INVENTORY_RECEIPTS_BUCKET, hasSupabaseConfig, supabase } from './supabase';
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


export async function fetchInventoryAdminData() {
  if (!hasSupabaseConfig) return { supplies: [], purchases: [], adjustments: [], mappings: [] };

  const [suppliesResult, purchasesResult, adjustmentsResult, mappingsResult] = await Promise.all([
    supabase.from('inventory_supplies').select('*').order('supply_name', { ascending: true }),
    supabase.from('inventory_purchase_logs').select('*, inventory_supplies(supply_name), inventory_receipt_attachments(*)').order('created_at', { ascending: false }).limit(50),
    supabase.from('inventory_adjustment_logs').select('*, inventory_supplies(supply_name), services(name)').order('created_at', { ascending: false }).limit(100),
    supabase.from('service_inventory_mappings').select('*, inventory_supplies(supply_name, active)').order('created_at', { ascending: true }),
  ]);

  const firstError = [suppliesResult, purchasesResult, adjustmentsResult, mappingsResult].find((result) => result.error)?.error;
  if (firstError) throw firstError;

  return {
    supplies: suppliesResult.data || [],
    purchases: purchasesResult.data || [],
    adjustments: adjustmentsResult.data || [],
    mappings: mappingsResult.data || [],
  };
}

export async function saveInventorySupply(supplyId, payload) {
  const { data, error } = await supabase.rpc('admin_update_inventory_supply', {
    p_supply_id: supplyId,
    p_current_quantity: Number(payload.current_quantity),
    p_low_threshold: Number(payload.low_threshold),
    p_active: payload.active,
  });
  if (error) throw error;
  return data;
}

export async function createInventoryPurchase(payload) {
  const { data, error } = await supabase.rpc('admin_create_inventory_purchase', {
    p_supply_id: payload.supplyId || null,
    p_new_supply_name: payload.newSupplyName || null,
    p_starting_quantity: Number(payload.startingQuantity || 0),
    p_low_threshold: Number(payload.lowThreshold || 0),
    p_quantity_increment: Number(payload.quantityIncrement || 0),
    p_total_cost: Number(payload.totalCost || 0),
    p_receipt_storage_key: payload.receiptStorageKey || null,
    p_receipt_file_name: payload.receiptFileName || null,
    p_receipt_content_type: payload.receiptContentType || null,
  });
  if (error) throw error;
  return data;
}

export async function createInventoryManualAdjustment(payload) {
  const { data, error } = await supabase.rpc('admin_create_inventory_manual_adjustment', {
    p_supply_id: payload.supplyId,
    p_change_amount: Number(payload.changeAmount || 0),
    p_reason: payload.reason || '',
    p_allow_negative: Boolean(payload.allowNegative),
  });
  if (error) throw error;
  return data;
}

export async function saveServiceInventoryMapping(payload) {
  const row = payload.id ? {
    id: payload.id,
    service_id: payload.serviceId,
    supply_id: payload.supplyId,
    amount_consumed: Number(payload.amountConsumed || 0),
  } : {
    service_id: payload.serviceId,
    supply_id: payload.supplyId,
    amount_consumed: Number(payload.amountConsumed || 0),
  };
  const { data, error } = await supabase.from('service_inventory_mappings').upsert(row, { onConflict: 'service_id,supply_id' }).select().single();
  if (error) throw error;
  return data;
}

export async function deleteServiceInventoryMapping(mappingId) {
  const { error } = await supabase.from('service_inventory_mappings').delete().eq('id', mappingId);
  if (error) throw error;
}

export async function uploadInventoryReceipt(file, storageKey) {
  const { error } = await supabase.storage.from(INVENTORY_RECEIPTS_BUCKET).upload(storageKey, file, { upsert: true, contentType: file.type });
  if (error) throw error;
}
