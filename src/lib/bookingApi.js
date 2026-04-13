export async function fetchAvailability(serviceIds, date) {
  const params = new URLSearchParams({ serviceIds: serviceIds.join(',') });
  if (date) params.set('date', date);
  const res = await fetch(`/.netlify/functions/availability?${params.toString()}`);
  return res.json();
}

export async function createBookingRequest(payload) {
  const res = await fetch('/.netlify/functions/create-booking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Failed to create booking');
  return body;
}

export async function fetchAdminAppointments() {
  const res = await fetch('/.netlify/functions/admin-appointments');
  return res.json();
}

export async function setAppointmentStatus(appointmentId, status) {
  const res = await fetch('/.netlify/functions/admin-appointments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set_status', appointmentId, status }),
  });
  return res.json();
}

export async function createBlockedTime(payload) {
  const res = await fetch('/.netlify/functions/admin-appointments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create_block', ...payload }),
  });
  return res.json();
}

export async function deleteBlockedTime(blockId) {
  const res = await fetch('/.netlify/functions/admin-appointments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_block', blockId }),
  });
  return res.json();
}
