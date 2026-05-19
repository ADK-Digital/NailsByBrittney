import { hasSupabaseConfig, supabase } from './supabase';

async function getAdminAuthHeaders(headers = {}) {
  if (!hasSupabaseConfig || !supabase) return headers;

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Admin authentication required.');

  return { ...headers, Authorization: `Bearer ${token}` };
}

export async function fetchAvailability(serviceIds) {
  const params = new URLSearchParams();
  serviceIds.forEach((serviceId) => params.append('serviceIds', serviceId));

  const res = await fetch(`/.netlify/functions/availability?${params.toString()}`);

  if (!res.ok) {
    throw new Error('Failed to fetch availability');
  }

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
  const res = await fetch('/.netlify/functions/admin-appointments', {
    headers: await getAdminAuthHeaders(),
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body.error || 'Failed to fetch admin appointments');
  return body;
}

export async function fetchArchivedAppointments() {
  const res = await fetch('/.netlify/functions/admin-appointments?archives=1', {
    headers: await getAdminAuthHeaders(),
  });
  return res.json();
}

async function downloadCsvFromAdminAppointments(queryString, fallbackFileName, failureMessage) {
  const res = await fetch(`/.netlify/functions/admin-appointments?${queryString}`, {
    headers: await getAdminAuthHeaders(),
  });

  if (!res.ok) {
    let message = failureMessage;
    try {
      const body = await res.json();
      message = body.error || message;
    } catch {
      // Keep the fallback download error when the response is not JSON.
    }
    throw new Error(message);
  }

  const disposition = res.headers.get('Content-Disposition') || '';
  const fileName = disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallbackFileName;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return { ok: true };
}

export async function downloadArchivedAppointment(fileName) {
  return downloadCsvFromAdminAppointments(`archive=${encodeURIComponent(fileName)}`, fileName, 'Failed to download archive');
}

export async function downloadPaymentsCsv() {
  return downloadCsvFromAdminAppointments('payments=1', 'payments.csv', 'Failed to export payments');
}

async function postAdminAppointmentAction(payload) {
  const res = await fetch('/.netlify/functions/admin-appointments', {
    method: 'POST',
    headers: await getAdminAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });

  const body = await res.json();
  if (!res.ok || body.error) {
    throw new Error(body.error || 'Admin appointment action failed');
  }
  return body;
}

export async function setAppointmentStatus(appointmentId, status, note) {
  return postAdminAppointmentAction({ action: 'set_status', appointmentId, status, note });
}

export async function adminChargeAppointment(payload) {
  return postAdminAppointmentAction({ action: 'charge', ...payload });
}

export async function adminRefundAppointment(payload) {
  return postAdminAppointmentAction({ action: 'refund', ...payload });
}

export async function applyAppointmentPayment(payload) {
  return postAdminAppointmentAction({ action: 'apply_payment', ...payload });
}

export async function fetchAppointmentStatusSummary(requestNumber) {
  const res = await fetch('/.netlify/functions/admin-appointments', {
    method: 'POST', headers: await getAdminAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ action: 'status_summary', requestNumber }),
  });
  return res.json();
}

export async function createBlockedTime(payload) {
  const res = await fetch('/.netlify/functions/admin-appointments', {
    method: 'POST', headers: await getAdminAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ action: 'create_block', ...payload }),
  });
  return res.json();
}

export async function deleteBlockedTime(blockId) {
  const res = await fetch('/.netlify/functions/admin-appointments', {
    method: 'POST', headers: await getAdminAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ action: 'delete_block', blockId }),
  });
  return res.json();
}

export async function createAdditionalAvailability(payload) {
  const res = await fetch('/.netlify/functions/admin-appointments', {
    method: 'POST', headers: await getAdminAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ action: 'create_additional_availability', ...payload }),
  });
  return res.json();
}

export async function deleteAdditionalAvailability(availabilityId) {
  const res = await fetch('/.netlify/functions/admin-appointments', {
    method: 'POST', headers: await getAdminAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ action: 'delete_additional_availability', availabilityId }),
  });
  return res.json();
}


export async function fetchClientMessages(payload) {
  const res = await fetch('/.netlify/functions/admin-appointments', {
    method: 'POST', headers: await getAdminAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ action: 'list_messages', ...payload }),
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body.error || 'Failed to load messages');
  return body;
}

export async function sendClientMessage(payload) {
  const res = await fetch('/.netlify/functions/admin-appointments', {
    method: 'POST', headers: await getAdminAuthHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ action: 'send_client_message', ...payload }),
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body.error || 'Failed to send message');
  return body;
}

export async function createAdminAppointment(payload) {
  return postAdminAppointmentAction({ action: 'create_admin_appointment', ...payload });
}
