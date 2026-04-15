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
  if (!res.ok) throw new Error(body.error || body.errors?.policyAcknowledged || 'Failed to create booking');
  return body;
}

export async function fetchAdminAppointments() {
  const res = await fetch('/.netlify/functions/admin-appointments');
  return res.json();
}

export async function setAppointmentStatus(appointmentId, status, note) {
  const res = await fetch('/.netlify/functions/admin-appointments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set_status', appointmentId, status, note }),
  });
  return res.json();
}

export async function adminChargeAppointment(payload) {
  const res = await fetch('/.netlify/functions/admin-appointments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'charge', ...payload }),
  });
  return res.json();
}

export async function adminRefundAppointment(payload) {
  const res = await fetch('/.netlify/functions/admin-appointments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'refund', ...payload }),
  });
  return res.json();
}

export async function fetchAppointmentStatusSummary(requestNumber) {
  const res = await fetch('/.netlify/functions/admin-appointments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status_summary', requestNumber }),
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
