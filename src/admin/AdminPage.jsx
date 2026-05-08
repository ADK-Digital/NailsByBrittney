import { useEffect, useMemo, useRef, useState } from 'react';
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
  downloadArchivedAppointment,
  fetchAdminAppointments,
  fetchArchivedAppointments,
  setAppointmentStatus,
  fetchClientMessages,
  sendClientMessage,
} from '../lib/bookingApi';
import { hasSupabaseConfig, supabase } from '../lib/supabase';

const APPOINTMENTS_PER_PAGE = 20;
const CUSTOMERS_PER_PAGE = 20;
const DEFAULT_APPOINTMENT_STATUSES = new Set(['pending_confirmation', 'pending', 'confirmed']);
const OPTIONAL_APPOINTMENT_STATUSES = ['completed', 'cancelled', 'declined', 'no_show', 'expired'];
const adminNavItems = [
  ['admin-appointments', 'Appointments'],
  ['admin-blocks', 'Blocked Times'],
  ['admin-customers', 'Customers'],
  ['admin-testimonials', 'Testimonials'],
  ['admin-services', 'Services'],
  ['admin-gallery', 'Gallery'],
];


const BOOKING_WINDOW_DAYS = 90;
const BLOCK_INTERVAL_MINUTES = 15;

const blockMonthFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
});

const blockDayFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  day: 'numeric',
});

const blockTimeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

function padTwo(value) {
  return String(value).padStart(2, '0');
}

function toLocalIsoDate(date) {
  return `${date.getFullYear()}-${padTwo(date.getMonth() + 1)}-${padTwo(date.getDate())}`;
}

function parseLocalIsoDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function monthKeyFromDate(isoDate) {
  return isoDate.slice(0, 7);
}

function formatBlockMonth(monthKey) {
  return blockMonthFormatter.format(parseLocalIsoDate(`${monthKey}-01`));
}

function formatBlockDay(isoDate) {
  return blockDayFormatter.format(parseLocalIsoDate(isoDate));
}

function formatTimeOption(minutes) {
  const date = new Date(2026, 0, 1, Math.floor(minutes / 60), minutes % 60);
  return blockTimeFormatter.format(date);
}

function buildTimeOptions() {
  const options = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += BLOCK_INTERVAL_MINUTES) {
    options.push({ value: `${padTwo(Math.floor(minutes / 60))}:${padTwo(minutes % 60)}`, label: formatTimeOption(minutes) });
  }
  return options;
}

function buildBookingWindowDates() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: BOOKING_WINDOW_DAYS }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    return toLocalIsoDate(date);
  });
}

function blockDateTimeToDate(row) {
  if (!row?.day || !row?.time) return null;
  const [year, month, day] = row.day.split('-').map(Number);
  const [hour, minute] = row.time.split(':').map(Number);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  return Number.isFinite(date.getTime()) ? date : null;
}

function createBlockRowFromDate(date) {
  const normalizedDate = new Date(date);
  normalizedDate.setSeconds(0, 0);
  const day = toLocalIsoDate(normalizedDate);
  return {
    month: monthKeyFromDate(day),
    day,
    time: `${padTwo(normalizedDate.getHours())}:${padTwo(normalizedDate.getMinutes())}`,
  };
}

function roundUpToInterval(date, intervalMinutes = BLOCK_INTERVAL_MINUTES) {
  const rounded = new Date(date);
  rounded.setSeconds(0, 0);
  const totalMinutes = rounded.getHours() * 60 + rounded.getMinutes();
  const roundedMinutes = Math.ceil(totalMinutes / intervalMinutes) * intervalMinutes;
  rounded.setHours(0, roundedMinutes, 0, 0);
  return rounded;
}

function buildInitialBlockRows() {
  const start = roundUpToInterval(new Date());
  const end = new Date(start);
  end.setHours(start.getHours() + 1);
  return {
    start: createBlockRowFromDate(start),
    end: createBlockRowFromDate(end),
  };
}

function normalizeBlockRowMonth(row, month, datesByMonth) {
  const days = datesByMonth.get(month) || [];
  const nextDay = days.includes(row.day) ? row.day : days[0] || row.day;
  return { ...row, month, day: nextDay };
}

function BlockDateTimeRow({ label, value, months, datesByMonth, timeOptions, onChange }) {
  const dayOptions = datesByMonth.get(value.month) || [];

  return <div className="block-datetime-row">
    <span className="block-datetime-label">{label}</span>
    <div className="block-datetime-controls">
      <label>
        <span>Month</span>
        <select value={value.month} onChange={(event) => onChange(normalizeBlockRowMonth(value, event.target.value, datesByMonth))}>
          {months.map((month) => <option key={month} value={month}>{formatBlockMonth(month)}</option>)}
        </select>
      </label>
      <label>
        <span>Day</span>
        <select value={value.day} onChange={(event) => onChange({ ...value, day: event.target.value })}>
          {dayOptions.map((day) => <option key={day} value={day}>{formatBlockDay(day)}</option>)}
        </select>
      </label>
      <label>
        <span>Time</span>
        <select value={value.time} onChange={(event) => onChange({ ...value, time: event.target.value })}>
          {timeOptions.map((time) => <option key={time.value} value={time.value}>{time.label}</option>)}
        </select>
      </label>
    </div>
  </div>;
}

function AddBlockPanel({ onCreate }) {
  const initialRows = useMemo(() => buildInitialBlockRows(), []);
  const [start, setStart] = useState(initialRows.start);
  const [end, setEnd] = useState(initialRows.end);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const bookingDates = useMemo(() => buildBookingWindowDates(), []);
  const timeOptions = useMemo(() => buildTimeOptions(), []);
  const datesByMonth = useMemo(() => bookingDates.reduce((map, date) => {
    const month = monthKeyFromDate(date);
    map.set(month, [...(map.get(month) || []), date]);
    return map;
  }, new Map()), [bookingDates]);
  const months = useMemo(() => Array.from(datesByMonth.keys()), [datesByMonth]);
  const startDate = blockDateTimeToDate(start);
  const endDate = blockDateTimeToDate(end);
  const isInvalid = !startDate || !endDate || endDate <= startDate;

  const submit = async (event) => {
    event.preventDefault();
    setMessage({ type: '', text: '' });
    if (isInvalid) {
      setMessage({ type: 'error', text: 'Block end must be after block start.' });
      return;
    }

    setBusy(true);
    try {
      await onCreate({ startAt: startDate.toISOString(), endAt: endDate.toISOString(), reason: 'Admin block' });
      setMessage({ type: 'success', text: 'Blocked time created.' });
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Unable to create blocked time.' });
    } finally {
      setBusy(false);
    }
  };

  return <form className="add-block-panel" onSubmit={submit}>
    <BlockDateTimeRow label="Block start" value={start} months={months} datesByMonth={datesByMonth} timeOptions={timeOptions} onChange={setStart} />
    <BlockDateTimeRow label="Block end" value={end} months={months} datesByMonth={datesByMonth} timeOptions={timeOptions} onChange={setEnd} />
    {isInvalid && <p className="admin-message error" role="alert">Block end must be after block start.</p>}
    {message.text && <p className={`admin-message ${message.type}`} role="status">{message.text}</p>}
    <button className="btn primary" type="submit" disabled={busy || isInvalid}>{busy ? 'Creating…' : 'Create Block'}</button>
  </form>;
}

const appointmentDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

const appointmentTimeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

function formatAppointmentDateTime(value) {
  const appointmentDate = new Date(value);
  if (!Number.isFinite(appointmentDate.getTime())) return 'Date unavailable';
  return `${appointmentDateFormatter.format(appointmentDate)} • ${appointmentTimeFormatter.format(appointmentDate)}`;
}

function formatBookingNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '---';
  return String(numeric).padStart(3, '0').slice(-3);
}

function reorderItems(items, fromIndex, toIndex) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) return items;
  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, movedItem);
  return nextItems.map((item, index) => ({ ...item, display_order: index + 1 }));
}

function ReorderableList({ items, renderFields, onReorder, getItemLabel = (item, idx) => `Item ${idx + 1}` }) {
  const canReorder = typeof onReorder === 'function';
  const moveItem = (fromIndex, toIndex) => {
    if (!canReorder) return;
    const reorderedItems = reorderItems(items, fromIndex, toIndex);
    if (reorderedItems === items) return;
    onReorder(reorderedItems);
  };

  return <ul className={`admin-edit-list${canReorder ? ' reorderable-list' : ''}`}>{items.map((item, idx) => <li
    key={item.id}
    className={`admin-item${canReorder ? ' reorderable-item' : ''}`}
  >
    {canReorder && <div className="reorder-strip" aria-label={`Reorder ${getItemLabel(item, idx)}`}>
      <span className="reorder-position">#{idx + 1}</span>
      <button type="button" className="reorder-arrow" onClick={() => moveItem(idx, idx - 1)} disabled={idx === 0} aria-label={`Move ${getItemLabel(item, idx)} up`}>↑</button>
      <button type="button" className="reorder-arrow" onClick={() => moveItem(idx, idx + 1)} disabled={idx === items.length - 1} aria-label={`Move ${getItemLabel(item, idx)} down`}>↓</button>
    </div>}
    <div className="admin-item-fields">{renderFields(item, idx)}</div>
  </li>)}</ul>;
}

function formatAdminStatus(status) {
  return String(status || 'unknown').replace(/_/g, ' ');
}

function statusClassName(status) {
  return `pill status-pill status-${String(status || 'unknown').replace(/_/g, '-')}`;
}

function formatServicePrice(service) {
  const priceNumber = getServicePriceNumber(service);
  const formattedPrice = Number.isInteger(priceNumber) ? String(priceNumber) : priceNumber.toFixed(2);
  return `$${formattedPrice}${service.is_variable_price ? '+' : ''}`;
}

function getServicePriceNumber(service) {
  const numeric = Number(service.price_min_numeric);
  if (Number.isFinite(numeric)) return numeric;

  const parsed = Number(String(service.price_text || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseCurrencyInput(value) {
  return value.replace(/[^0-9.]/g, '');
}

function formatCommunicationPreference(preference) {
  if (!preference || preference === 'both') return 'SMS + email';
  return preference;
}

function centsToDollars(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

function getSucceededEventTotal(events, eventType) {
  return events
    .filter((event) => event.event_type === eventType && event.status === 'succeeded')
    .reduce((sum, event) => sum + Number(event.amount_cents || 0), 0);
}

function getAppointmentSortPriority(status) {
  const normalizedStatus = String(status || '').toLowerCase();
  if (normalizedStatus === 'pending_confirmation' || normalizedStatus === 'pending') return 0;
  if (normalizedStatus === 'confirmed') return 1;
  if (normalizedStatus === 'no_show') return 2;
  if (normalizedStatus === 'completed') return 3;
  if (normalizedStatus === 'cancelled' || normalizedStatus === 'declined') return 4;
  return 2;
}

function sortAppointmentsForAdmin(items) {
  return [...items].sort((a, b) => {
    const priorityDelta = getAppointmentSortPriority(a.status) - getAppointmentSortPriority(b.status);
    if (priorityDelta !== 0) return priorityDelta;

    const aStart = new Date(a.start_at).getTime();
    const bStart = new Date(b.start_at).getTime();
    return (Number.isFinite(aStart) ? aStart : 0) - (Number.isFinite(bStart) ? bStart : 0);
  });
}

function shouldShowAppointment(appointment, visibleOptionalStatuses) {
  const normalizedStatus = String(appointment.status || '').toLowerCase();
  return DEFAULT_APPOINTMENT_STATUSES.has(normalizedStatus) || visibleOptionalStatuses.has(normalizedStatus);
}

function sortCustomersAlphabetically(items) {
  return [...items].sort((a, b) => {
    const lastDelta = String(a.last_name || '').localeCompare(String(b.last_name || ''), undefined, { sensitivity: 'base' });
    if (lastDelta !== 0) return lastDelta;
    return String(a.first_name || '').localeCompare(String(b.first_name || ''), undefined, { sensitivity: 'base' });
  });
}

function AdminSecondaryButton({ className = '', ...props }) {
  return <button type="button" className={`admin-secondary-button${className ? ` ${className}` : ''}`} {...props} />;
}


function formatMessageTimestamp(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function MessageThread({ customer, appointment = null }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState({ type: '', text: '' });
  const threadRef = useRef(null);
  const targetPayload = appointment?.id ? { appointmentId: appointment.id } : { customerId: customer?.id };
  const hasThreadOverflow = messages.length > 6;

  const loadMessages = async () => {
    if (!customer?.id && !appointment?.id) return;
    setLoading(true);
    setNotice({ type: '', text: '' });
    try {
      const data = await fetchClientMessages(targetPayload);
      setMessages(data.messages || []);
    } catch (error) {
      setNotice({ type: 'error', text: error.message || 'Unable to load messages.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMessages();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id, appointment?.id]);

  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages.length, expanded]);

  const submit = async (event) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    setNotice({ type: '', text: '' });
    try {
      const result = await sendClientMessage({ ...targetPayload, body });
      setMessages(result.messages || []);
      setDraft('');
      const sentParts = [];
      if (result.sent?.sms) sentParts.push('SMS');
      if (result.sent?.email) sentParts.push('email');
      setNotice({ type: result.failures?.length ? 'error' : 'success', text: sentParts.length ? `Sent by ${sentParts.join(' + ')}.` : 'Message saved, but no delivery channel was available.' });
    } catch (error) {
      setNotice({ type: 'error', text: error.message || 'Unable to send message.' });
    } finally {
      setBusy(false);
    }
  };

  return <section className={`message-thread-card${expanded ? ' enlarged' : ''}`} aria-label={`Message history with ${customer?.first_name || 'customer'}`}>
    <div className="message-thread-head">
      <div>
        <h4>Messages</h4>
        <p className="muted">Routes by preference: {formatCommunicationPreference(customer?.communication_preference)}</p>
      </div>
      <div className="message-thread-actions">
        {hasThreadOverflow && <button type="button" className="message-thread-expand" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Shrink' : 'Enlarge'}</button>}
        {expanded && <button type="button" className="message-thread-close" onClick={() => setExpanded(false)} aria-label="Close enlarged message thread">×</button>}
      </div>
    </div>

    <div className="message-thread-scroll" ref={threadRef}>
      {loading && <p className="muted">Loading messages…</p>}
      {!loading && !messages.length && <p className="muted empty-thread">No message history yet.</p>}
      {messages.map((message) => {
        const outbound = message.direction === 'admin_to_customer';
        return <div key={message.id} className={`message-bubble-row ${outbound ? 'outbound' : 'inbound'}`}>
          <div className="message-bubble">
            <p>{message.body}</p>
            <span>{outbound ? 'Admin' : 'Client'} • {message.channel} • {formatMessageTimestamp(message.created_at)}</span>
          </div>
        </div>;
      })}
    </div>

    <form className="message-compose" onSubmit={submit}>
      <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a message…" rows={2} />
      <button className="btn primary" type="submit" disabled={busy || !draft.trim()}>{busy ? 'Sending…' : 'Send'}</button>
    </form>
    {notice.text && <p className={`admin-message ${notice.type}`} role="status">{notice.text}</p>}
  </section>;
}

function AppointmentCard({ appointment, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const [serviceAmount, setServiceAmount] = useState('');
  const [latePct, setLatePct] = useState('25');
  const [noShowPct, setNoShowPct] = useState('50');

  const events = appointment.appointment_financial_events || [];
  const sortedEvents = [...events].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const serviceChargedCents = getSucceededEventTotal(events, 'service_charge');
  const serviceRefundedCents = getSucceededEventTotal(events, 'refund_service');
  const serviceRefundableCents = Math.max(0, serviceChargedCents - serviceRefundedCents);
  const serviceRefundableDollars = centsToDollars(serviceRefundableCents);
  const [serviceRefundAmount, setServiceRefundAmount] = useState(serviceRefundableDollars);
  const customerName = `${appointment.customers?.first_name || ''} ${appointment.customers?.last_name || ''}`.trim() || 'Customer';
  const appointmentDateTime = formatAppointmentDateTime(appointment.start_at);

  useEffect(() => {
    setServiceRefundAmount(serviceRefundableDollars);
  }, [appointment.id, serviceRefundableDollars]);

  const call = async (fn) => { await fn(); await onRefresh(); };

  return <article className={`card appointment-card${expanded ? ' expanded' : ''}`}>
    {!expanded && <button type="button" className="appointment-toggle" onClick={() => setExpanded(true)} aria-expanded={expanded}>
      <span className="appointment-title">
        <strong>{appointmentDateTime}</strong>
        <span className="appointment-customer">{customerName}</span>
        <span className="appointment-booking-number">Booking #{formatBookingNumber(appointment.booking_request_number)}</span>
      </span>
      <span className="appointment-toggle-status">
        <span className={statusClassName(appointment.status)}><span>Status</span>{formatAdminStatus(appointment.status)}</span>
        <span className="appointment-arrow" aria-hidden="true">⌄</span>
      </span>
    </button>}

    {expanded && <div className="appointment-details">
      <div className="appointment-head">
        <div className="appointment-title appointment-title-expanded">
          <strong>{appointmentDateTime}</strong>
          <span className="appointment-customer">{customerName}</span>
          <span className="appointment-booking-number">Booking #{formatBookingNumber(appointment.booking_request_number)}</span>
        </div>
        <div className="appointment-meta" aria-label="Booking status details">
          <span className={statusClassName(appointment.status)}><span>Status</span>{formatAdminStatus(appointment.status)}</span>
          <span className="pill meta-pill"><span>Service payment</span>{appointment.service_payment_status || 'unpaid'}</span>
          <span className="pill meta-pill"><span>Late fee</span>{appointment.late_fee_status || 'unpaid'}</span>
          <span className="pill meta-pill"><span>No-show fee</span>{appointment.no_show_fee_status || 'unpaid'}</span>
          <button type="button" className="appointment-arrow appointment-collapse-button" onClick={() => setExpanded(false)} aria-label="Collapse appointment" aria-expanded={expanded}>⌃</button>
        </div>
      </div>
      <p className="muted">Communication preference: {formatCommunicationPreference(appointment.customers?.communication_preference)} • Card: {appointment.customers?.card_on_file_status || 'missing'} {appointment.customers?.card_brand ? `(${appointment.customers.card_brand} ••••${appointment.customers.card_last4 || ''})` : ''}</p>

      <MessageThread customer={appointment.customers} appointment={appointment} />

      <div className="admin-action-grid">
        {['confirmed', 'declined', 'cancelled', 'completed', 'no_show'].map((status) => <button key={status} className="btn" onClick={() => call(() => setAppointmentStatus(appointment.id, status))}>{formatAdminStatus(status)}</button>)}
      </div>

      <div className="admin-action-grid">
        <button className="btn" onClick={() => call(() => adminChargeAppointment({ appointmentId: appointment.id, target: 'late', percent: Number(latePct || 25) }))}>Charge late fee</button>
        <input value={latePct} onChange={(e) => setLatePct(parseCurrencyInput(e.target.value))} placeholder="25" />
        <button className="btn" onClick={() => call(() => adminChargeAppointment({ appointmentId: appointment.id, target: 'no_show', percent: Number(noShowPct || 50) }))}>Charge no-show fee</button>
        <input value={noShowPct} onChange={(e) => setNoShowPct(parseCurrencyInput(e.target.value))} placeholder="50" />
        <button className="btn" onClick={() => call(() => adminChargeAppointment({ appointmentId: appointment.id, target: 'service', amount: Number(serviceAmount || 0) }))}>Charge services</button>
        <input
          value={serviceAmount}
          onChange={(e) => setServiceAmount(parseCurrencyInput(e.target.value))}
          placeholder="Type service amount (e.g. 85.00)"
        />
      </div>

      <div className="admin-action-grid">
        <button className="btn" onClick={() => call(() => adminRefundAppointment({ appointmentId: appointment.id, target: 'late' }))}>Refund late fee</button>
        <button className="btn" onClick={() => call(() => adminRefundAppointment({ appointmentId: appointment.id, target: 'no_show' }))}>Refund no-show fee</button>
        <button className="btn" onClick={() => call(() => adminRefundAppointment({ appointmentId: appointment.id, target: 'service' }))}>Refund services full</button>
        <button className="btn" onClick={() => call(() => adminRefundAppointment({ appointmentId: appointment.id, target: 'service', amount: Number(serviceRefundAmount || 0) }))}>Refund services</button>
        <input
          type="text"
          inputMode="decimal"
          value={serviceRefundAmount}
          onChange={(e) => setServiceRefundAmount(parseCurrencyInput(e.target.value))}
          placeholder={serviceRefundableDollars}
          aria-label="Service refund dollar amount"
        />
      </div>
      <p className="muted refund-helper">Refundable service amount: ${serviceRefundableDollars} of ${centsToDollars(serviceChargedCents)} charged.</p>

      {!!sortedEvents.length && <details><summary>Payment history ({sortedEvents.length})</summary><ul>{sortedEvents.map((event) => <li key={event.id}>{new Date(event.created_at).toLocaleString()} • {event.event_type} • ${centsToDollars(event.amount_cents)} • {event.status} • {event.initiated_by}</li>)}</ul></details>}
    </div>}
  </article>;
}


function CustomerCard({ customer, appointments }) {
  const [expanded, setExpanded] = useState(false);
  const customerName = `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Customer';
  const sortedCustomerAppointments = useMemo(() => [...appointments].sort((a, b) => {
    const aStart = new Date(a.start_at).getTime();
    const bStart = new Date(b.start_at).getTime();
    return (Number.isFinite(bStart) ? bStart : 0) - (Number.isFinite(aStart) ? aStart : 0);
  }), [appointments]);

  return <article className={`card appointment-card customer-card${expanded ? ' expanded' : ''}`}>
    {!expanded && <button type="button" className="appointment-toggle customer-toggle" onClick={() => setExpanded(true)} aria-expanded={expanded}>
      <span className="appointment-title customer-title">
        <strong>{customerName}</strong>
        <span className="appointment-customer">{customer.phone || 'No phone on file'}</span>
        <span className="appointment-booking-number">{customer.email || 'No email on file'}</span>
      </span>
      <span className="appointment-toggle-status">
        <span className="pill meta-pill"><span>Appointments</span>{sortedCustomerAppointments.length}</span>
        <span className="appointment-arrow" aria-hidden="true">⌄</span>
      </span>
    </button>}

    {expanded && <div className="appointment-details customer-details">
      <div className="appointment-head">
        <div className="appointment-title appointment-title-expanded customer-title">
          <strong>{customerName}</strong>
          <span className="appointment-customer">{customer.phone || 'No phone on file'}</span>
          <span className="appointment-booking-number">{customer.email || 'No email on file'}</span>
        </div>
        <div className="appointment-meta">
          <span className="pill meta-pill"><span>Preference</span>{formatCommunicationPreference(customer.communication_preference)}</span>
          <span className="pill meta-pill"><span>Card</span>{customer.card_on_file_status || 'missing'}</span>
          <button type="button" className="appointment-arrow appointment-collapse-button" onClick={() => setExpanded(false)} aria-label="Collapse customer" aria-expanded={expanded}>⌃</button>
        </div>
      </div>

      <p className="muted">Card: {customer.card_on_file_status || 'missing'} {customer.card_brand ? `(${customer.card_brand} ••••${customer.card_last4 || ''})` : ''}</p>

      <MessageThread customer={customer} />

      <div className="customer-appointment-list">
        <h4>Scheduled appointments</h4>
        {sortedCustomerAppointments.length ? <ul>{sortedCustomerAppointments.map((appointment) => <li key={appointment.id}>
          <span>{formatAppointmentDateTime(appointment.start_at)}</span>
          <span className="appointment-booking-number">Booking #{formatBookingNumber(appointment.booking_request_number)}</span>
          <span className={statusClassName(appointment.status)}><span>Status</span>{formatAdminStatus(appointment.status)}</span>
        </li>)}</ul> : <p className="muted">No appointments on file.</p>}
      </div>

      {!!(customer.customer_notes || []).length && <div className="customer-notes-list">
        <h4>Notes</h4>
        <ul>{(customer.customer_notes || []).map((note) => <li key={note.id}>{new Date(note.created_at).toLocaleDateString()} - {note.note_text}</li>)}</ul>
      </div>}
    </div>}
  </article>;
}

function AppointmentArchivePanel({ open, archives, onToggle, onLoad, onDownload }) {
  return <div className="appointment-archive-panel">
    <button type="button" className="admin-secondary-button" onClick={async () => { await onLoad(); onToggle(); }}>Archived appointments</button>
    {open && <div className="archive-list card">
      <h3>Archived appointments</h3>
      {archives.length ? <ul>{archives.map((archive) => <li key={archive.id || archive.file_name}>
        <button type="button" className="link-button" onClick={() => onDownload(archive.file_name)}>{archive.file_name}</button>
        <span>{archive.appointment_count || 0} appointment(s)</span>
      </li>)}</ul> : <p className="muted">No archived appointment CSV files yet.</p>}
    </div>}
  </div>;
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
  const testimonialOrderSaveToken = useRef(0);
  const galleryOrderSaveToken = useRef(0);
  const serviceOrderSaveToken = useRef(0);
  const [appointmentPage, setAppointmentPage] = useState(0);
  const [customerPage, setCustomerPage] = useState(0);
  const [archivesOpen, setArchivesOpen] = useState(false);
  const [appointmentArchives, setAppointmentArchives] = useState([]);
  const [addBlockOpen, setAddBlockOpen] = useState(false);
  const [visibleOptionalAppointmentStatuses, setVisibleOptionalAppointmentStatuses] = useState(() => new Set());

  const filteredAppointments = useMemo(() => appointments.filter((appointment) => shouldShowAppointment(appointment, visibleOptionalAppointmentStatuses)), [appointments, visibleOptionalAppointmentStatuses]);
  const sortedAppointments = useMemo(() => sortAppointmentsForAdmin(filteredAppointments), [filteredAppointments]);
  const appointmentPageCount = Math.max(1, Math.ceil(sortedAppointments.length / APPOINTMENTS_PER_PAGE));
  const currentAppointmentPage = Math.min(appointmentPage, appointmentPageCount - 1);
  const appointmentPageStart = currentAppointmentPage * APPOINTMENTS_PER_PAGE;
  const appointmentPageEnd = Math.min(appointmentPageStart + APPOINTMENTS_PER_PAGE, sortedAppointments.length);
  const pagedAppointments = sortedAppointments.slice(appointmentPageStart, appointmentPageEnd);
  const sortedCustomers = useMemo(() => sortCustomersAlphabetically(customers), [customers]);
  const customerPageCount = Math.max(1, Math.ceil(sortedCustomers.length / CUSTOMERS_PER_PAGE));
  const currentCustomerPage = Math.min(customerPage, customerPageCount - 1);
  const customerPageStart = currentCustomerPage * CUSTOMERS_PER_PAGE;
  const customerPageEnd = Math.min(customerPageStart + CUSTOMERS_PER_PAGE, sortedCustomers.length);
  const pagedCustomers = sortedCustomers.slice(customerPageStart, customerPageEnd);
  const appointmentsByCustomerId = useMemo(() => {
    const grouped = new Map();
    appointments.forEach((appointment) => {
      if (!appointment.customer_id) return;
      grouped.set(appointment.customer_id, [...(grouped.get(appointment.customer_id) || []), appointment]);
    });
    return grouped;
  }, [appointments]);

  useEffect(() => {
    if (appointmentPage > appointmentPageCount - 1) setAppointmentPage(Math.max(0, appointmentPageCount - 1));
  }, [appointmentPage, appointmentPageCount]);

  const toggleOptionalAppointmentStatus = (status) => {
    setVisibleOptionalAppointmentStatuses((previous) => {
      const next = new Set(previous);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
    setAppointmentPage(0);
  };

  useEffect(() => {
    if (customerPage > customerPageCount - 1) setCustomerPage(Math.max(0, customerPageCount - 1));
  }, [customerPage, customerPageCount]);

  const refreshBookingAdmin = async () => {
    const data = await fetchAdminAppointments();
    setAppointments(data.appointments || []);
    setCustomers(data.customers || []);
    setBlockedTimes(data.blockedTimes || []);
  };

  const refreshAppointmentArchives = async () => {
    const data = await fetchArchivedAppointments();
    setAppointmentArchives(data.archives || []);
  };

  const refreshServiceList = async () => setServices(await fetchServices());
  const refreshGalleryList = async () => setGallery(await fetchGalleryItems());

  const saveVisualOrder = async (table, items, setItems, refreshList, saveTokenRef) => {
    const orderedItems = items.map((item, index) => ({ ...item, display_order: index + 1 }));
    const saveToken = saveTokenRef.current + 1;
    saveTokenRef.current = saveToken;
    setItems(orderedItems);
    if (!hasSupabaseConfig) return;

    const refreshLatestOrder = async () => {
      if (saveTokenRef.current !== saveToken) return;
      try {
        await refreshList();
      } catch {
        // Keep the optimistic order visible if the post-save refresh cannot complete.
      }
    };

    try {
      await updateOrder(table, orderedItems);
    } catch {
      // Keep the optimistic order visible; a successful refresh below will restore server state if available.
    } finally {
      await refreshLatestOrder();
    }
  };

  const saveTestimonialVisualOrder = (orderedTestimonials) => {
    void saveVisualOrder('testimonials', orderedTestimonials, setTestimonials, async () => setTestimonials(await fetchTestimonials()), testimonialOrderSaveToken);
  };

  const saveGalleryVisualOrder = (orderedGallery) => {
    void saveVisualOrder('gallery_items', orderedGallery, setGallery, refreshGalleryList, galleryOrderSaveToken);
  };

  const saveServiceVisualOrder = (orderedServices) => {
    void saveVisualOrder('services', orderedServices, setServices, refreshServiceList, serviceOrderSaveToken);
  };

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
  }, []);

  useEffect(() => {
    if (hasSupabaseConfig && !session) return;
    refreshBookingAdmin().catch(() => {
      setAppointments([]);
      setCustomers([]);
      setBlockedTimes([]);
    });
  }, [session]);

  const signedIn = useMemo(() => (!hasSupabaseConfig ? true : Boolean(session)), [session]);
  const signIn = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await supabase.auth.signInWithPassword({ email: fd.get('email'), password: fd.get('password') });
  };

  const uploadSelectedGalleryPhotos = async () => {
    if (!selectedGalleryFiles.length) return setGalleryMessage({ type: 'error', text: 'Please choose at least one photo to upload.' });
    if (!hasSupabaseConfig) {
      const mockRows = selectedGalleryFiles.map((file, index) => ({ id: crypto.randomUUID(), storage_key: `local/${Date.now()}-${index}-${file.name}`, caption: galleryCaptionDraft.trim(), display_order: gallery.length + index + 1, imageUrl: URL.createObjectURL(file) }));
      setGallery((prev) => [...prev, ...mockRows]);
      setSelectedGalleryFiles([]);
      setGalleryCaptionDraft('');
      setGalleryMessage({ type: 'success', text: `Added ${mockRows.length} local sample photo(s).` });
      return undefined;
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
    return undefined;
  };

  const updateServicePrice = (serviceId, nextValue) => {
    const numericText = parseCurrencyInput(nextValue);
    const numericValue = Number(numericText || 0);
    setServices((previous) => previous.map((service) => (service.id === serviceId ? {
      ...service,
      price_min_numeric: numericValue,
      price_text: formatServicePrice({ ...service, price_min_numeric: numericValue }),
    } : service)));
  };

  const updateServiceVariablePrice = (serviceId, checked) => {
    setServices((previous) => previous.map((service) => (service.id === serviceId ? {
      ...service,
      is_variable_price: checked,
      price_text: formatServicePrice({ ...service, is_variable_price: checked }),
    } : service)));
  };

  const saveService = async (service, idx) => {
    if (!hasSupabaseConfig) return;
    const priceText = formatServicePrice(service);
    await updateRecord('services', service.id, {
      name: service.name,
      price_text: priceText,
      price_min_numeric: getServicePriceNumber(service),
      duration: `${service.duration_minutes} min`,
      duration_minutes: service.duration_minutes,
      is_variable_price: service.is_variable_price,
      description: service.description,
      type: service.type || 'base',
      requires_service_ids: service.requires_service_ids || [],
      display_order: idx + 1,
    });
    await refreshServiceList();
  };

  if (!signedIn) return <main className="admin-wrap"><h1>Admin Login</h1><form onSubmit={signIn} className="admin-form"><label>Email<input name="email" type="email" required /></label><label>Password<input name="password" type="password" required /></label><button className="btn primary">Sign in</button></form></main>;

  return <main className="admin-wrap"><h1>Nails by Brittney Admin</h1>
    {hasSupabaseConfig && <div className="admin-top-actions"><button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button></div>}
    <nav className="admin-section-nav" aria-label="Admin section navigation">
      {adminNavItems.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
    </nav>

    <section id="admin-appointments" className="admin-section admin-section-appointments"><h2>Appointments</h2><div className="admin-section-actions"><button className="btn" onClick={refreshBookingAdmin}>Refresh</button></div>
      <div className="appointment-filter-panel" aria-label="Appointment status filters">
        <span className="appointment-filter-label">Show hidden statuses:</span>
        {OPTIONAL_APPOINTMENT_STATUSES.map((status) => <label key={status} className={`appointment-filter-pill${visibleOptionalAppointmentStatuses.has(status) ? ' active' : ''}`}>
          <input type="checkbox" checked={visibleOptionalAppointmentStatuses.has(status)} onChange={() => toggleOptionalAppointmentStatus(status)} />
          {formatAdminStatus(status)}
        </label>)}
      </div>
      <div className="admin-list">{pagedAppointments.map((appointment) => <AppointmentCard key={appointment.id} appointment={appointment} onRefresh={refreshBookingAdmin} />)}</div>
      {sortedAppointments.length > APPOINTMENTS_PER_PAGE && <div className="appointment-pagination" aria-label="Appointment pagination">
        <button className="admin-secondary-button" type="button" onClick={() => setAppointmentPage((page) => Math.max(0, page - 1))} disabled={currentAppointmentPage === 0}>‹</button>
        <span>{sortedAppointments.length ? appointmentPageStart + 1 : 0}-{appointmentPageEnd} of {sortedAppointments.length}</span>
        <button className="admin-secondary-button" type="button" onClick={() => setAppointmentPage((page) => Math.min(appointmentPageCount - 1, page + 1))} disabled={currentAppointmentPage >= appointmentPageCount - 1}>›</button>
      </div>}
      <AppointmentArchivePanel open={archivesOpen} archives={appointmentArchives} onToggle={() => setArchivesOpen((value) => !value)} onLoad={refreshAppointmentArchives} onDownload={downloadArchivedAppointment} />
    </section>

    <section id="admin-blocks" className="admin-section admin-section-blocks"><h2>Blocked Times</h2>
      <div className="admin-section-actions"><button className="btn" type="button" onClick={() => setAddBlockOpen((open) => !open)}>{addBlockOpen ? 'Close Add Block' : 'Add Block'}</button></div>
      {addBlockOpen && <AddBlockPanel onCreate={async (payload) => {
        const result = await createBlockedTime(payload);
        if (result?.error) throw new Error(result.error);
        await refreshBookingAdmin();
      }} />}
      <div className="blocked-time-list">{blockedTimes.map((block) => <div className="blocked-time-item" key={block.id}><span>{new Date(block.start_at).toLocaleString()} - {new Date(block.end_at).toLocaleString()} ({block.reason})</span> <AdminSecondaryButton onClick={async () => { await deleteBlockedTime(block.id); refreshBookingAdmin(); }}>Delete</AdminSecondaryButton></div>)}</div>
    </section>

    <section id="admin-customers" className="admin-section admin-section-customers"><h2>Customers</h2><div className="admin-list customer-list">{pagedCustomers.map((customer) => <CustomerCard key={customer.id} customer={customer} appointments={appointmentsByCustomerId.get(customer.id) || []} />)}</div>
      {sortedCustomers.length > CUSTOMERS_PER_PAGE && <div className="appointment-pagination" aria-label="Customer pagination">
        <button className="admin-secondary-button" type="button" onClick={() => setCustomerPage((page) => Math.max(0, page - 1))} disabled={currentCustomerPage === 0}>‹</button>
        <span>{customerPageStart + 1}-{customerPageEnd} of {sortedCustomers.length}</span>
        <button className="admin-secondary-button" type="button" onClick={() => setCustomerPage((page) => Math.min(customerPageCount - 1, page + 1))} disabled={currentCustomerPage >= customerPageCount - 1}>›</button>
      </div>}
    </section>

    <section id="admin-testimonials" className="admin-section admin-section-testimonials"><h2>Testimonials</h2><div className="admin-section-actions"><button className="btn" onClick={async () => { const item = { customer: 'Customer Name', quote: 'Editable testimonial quote.', display_order: testimonials.length + 1 }; const created = hasSupabaseConfig ? await createRecord('testimonials', item) : { ...item, id: crypto.randomUUID() }; setTestimonials((previous) => [...previous, created]); }}>Add Testimonial</button></div>
      <ReorderableList items={testimonials} onReorder={saveTestimonialVisualOrder} getItemLabel={(testimonial) => testimonial.customer || 'testimonial'} renderFields={(testimonial) => <><input value={testimonial.customer} onChange={(e) => setTestimonials((previous) => previous.map((item) => item.id === testimonial.id ? { ...item, customer: e.target.value } : item))} /><textarea value={testimonial.quote} onChange={(e) => setTestimonials((previous) => previous.map((item) => item.id === testimonial.id ? { ...item, quote: e.target.value } : item))} /><AdminSecondaryButton onClick={async () => hasSupabaseConfig && updateRecord('testimonials', testimonial.id, { customer: testimonial.customer, quote: testimonial.quote })}>Save</AdminSecondaryButton><AdminSecondaryButton className="danger" onClick={async () => { if (hasSupabaseConfig) await deleteRecord('testimonials', testimonial.id); setTestimonials((previous) => previous.filter((item) => item.id !== testimonial.id)); }}>Delete</AdminSecondaryButton></>} />
    </section>

    <section id="admin-services" className="admin-section admin-section-services"><h2>Services</h2><div className="admin-section-actions"><button className="btn" onClick={async () => {
      const item = { name: 'New Service', price_text: '$0', price_min_numeric: 0, duration: '30 min', duration_minutes: 30, is_variable_price: false, description: 'Service details', type: 'base', requires_service_ids: [], display_order: services.length + 1, active: true };
      const created = hasSupabaseConfig ? await createRecord('services', item) : { ...item, id: crypto.randomUUID() };
      if (hasSupabaseConfig) await refreshServiceList(); else setServices((previous) => [...previous, created]);
    }}>Add Service</button></div>
      <ReorderableList items={services} onReorder={saveServiceVisualOrder} getItemLabel={(service) => service.name || 'service'} renderFields={(service, idx) => <><label>Service name<input value={service.name} onChange={(e) => setServices((previous) => previous.map((item) => item.id === service.id ? { ...item, name: e.target.value } : item))} /></label><label>Price<input type="number" min="0" step="0.01" value={getServicePriceNumber(service)} onChange={(e) => updateServicePrice(service.id, e.target.value)} /></label><label>Duration (minutes)<input type="number" value={service.duration_minutes || 0} onChange={(e) => setServices((previous) => previous.map((item) => item.id === service.id ? { ...item, duration_minutes: Number(e.target.value), duration: `${e.target.value} min` } : item))} /></label><label className="variable-price-row"><span>Variable price?</span><input type="checkbox" checked={Boolean(service.is_variable_price)} onChange={(e) => updateServiceVariablePrice(service.id, e.target.checked)} /></label><label>Description<textarea value={service.description} onChange={(e) => setServices((previous) => previous.map((item) => item.id === service.id ? { ...item, description: e.target.value } : item))} /></label><AdminSecondaryButton onClick={() => saveService(service, idx)}>Save</AdminSecondaryButton><AdminSecondaryButton className="danger" onClick={async () => { if (hasSupabaseConfig) { await deleteRecord('services', service.id); await refreshServiceList(); return; } setServices((previous) => previous.filter((item) => item.id !== service.id)); }}>Delete</AdminSecondaryButton></>} />
    </section>

    <section id="admin-gallery" className="admin-section admin-section-gallery"><h2>Gallery</h2><div className="gallery-upload-panel"><label htmlFor="gallery-file-picker">Select photo(s) to upload</label><input id="gallery-file-picker" type="file" accept="image/*" multiple onChange={(e) => { setSelectedGalleryFiles(Array.from(e.target.files || [])); setGalleryMessage({ type: '', text: '' }); }} /><label htmlFor="gallery-caption-input">Caption (optional)</label><input id="gallery-caption-input" placeholder="Caption for selected photo(s)" value={galleryCaptionDraft} onChange={(e) => setGalleryCaptionDraft(e.target.value)} /><button className="btn primary" onClick={uploadSelectedGalleryPhotos} disabled={galleryUploadBusy}>{galleryUploadBusy ? 'Uploading...' : 'Upload Selected Photos'}</button>{!!selectedGalleryFiles.length && <p className="muted">{selectedGalleryFiles.length} file(s) selected.</p>}{!!galleryMessage.text && <p className={galleryMessage.type === 'error' ? 'admin-message error' : 'admin-message success'}>{galleryMessage.text}</p>}</div>
      <ReorderableList items={gallery} onReorder={saveGalleryVisualOrder} getItemLabel={(galleryItem) => galleryItem.caption || 'gallery item'} renderFields={(galleryItem) => <div className="gallery-admin-item">{(galleryItem.imageUrl || galleryItem.local_path) ? <img src={galleryItem.imageUrl || galleryItem.local_path} alt="Gallery" /> : <div className="missing-image">No image</div>}<input placeholder="Caption" value={galleryItem.caption || ''} onChange={(e) => setGallery((previous) => previous.map((item) => item.id === galleryItem.id ? { ...item, caption: e.target.value } : item))} /><AdminSecondaryButton onClick={async () => { if (!hasSupabaseConfig) return; await updateRecord('gallery_items', galleryItem.id, { caption: galleryItem.caption || '' }); await refreshGalleryList(); }}>Save</AdminSecondaryButton><AdminSecondaryButton className="danger" onClick={async () => { if (hasSupabaseConfig) { await deleteGalleryImage(galleryItem.storage_key); await deleteRecord('gallery_items', galleryItem.id); await refreshGalleryList(); return; } setGallery((previous) => previous.filter((item) => item.id !== galleryItem.id)); }}>Delete</AdminSecondaryButton></div>} />
    </section>
  </main>;
}
