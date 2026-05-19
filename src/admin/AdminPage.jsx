import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createRecord,
  deleteGalleryImage,
  deleteRecord,
  createInventoryManualAdjustment,
  createInventoryPurchase,
  deleteServiceInventoryMapping,
  fetchGalleryItems,
  fetchServices,
  fetchTestimonials,
  fetchInventoryAdminData,
  saveInventorySupply,
  saveServiceInventoryMapping,
  updateOrder,
  updateRecord,
  uploadGalleryImage,
  uploadInventoryReceipt,
} from '../lib/api';
import {
  adminChargeAppointment,
  adminRefundAppointment,
  applyAppointmentPayment,
  createAdditionalAvailability,
  createBlockedTime,
  deleteAdditionalAvailability,
  deleteBlockedTime,
  downloadArchivedAppointment,
  downloadPaymentsCsv,
  fetchAdminAppointments,
  fetchArchivedAppointments,
  setAppointmentStatus,
  fetchClientMessages,
  sendClientMessage,
  createAdminAppointment,
  fetchAvailability,
} from '../lib/bookingApi';
import { hasSupabaseConfig, supabase } from '../lib/supabase';

const CUSTOMERS_PER_PAGE = 10;
const DEFAULT_APPOINTMENT_STATUSES = new Set(['pending_confirmation', 'pending', 'confirmed']);
const OPTIONAL_APPOINTMENT_STATUSES = ['completed', 'cancelled', 'declined', 'no_show', 'expired'];
const adminNavItems = [
  ['admin-appointments', 'Appointments'],
  ['admin-blocks', 'Blocked Times'],
  ['admin-additional-availability', 'Additional Times'],
  ['admin-customers', 'Customers'],
  ['admin-testimonials', 'Testimonials'],
  ['admin-services', 'Services'],
  ['admin-inventory', 'Inventory'],
  ['admin-gallery', 'Gallery'],
];


const BOOKING_WINDOW_DAYS = 90;
const BLOCK_INTERVAL_MINUTES = 15;
const DEFAULT_LATE_FEE_PERCENT = 25;
const DEFAULT_NO_SHOW_FEE_PERCENT = 50;
const CHEVRON_DOWN = '⌄';
const CHEVRON_UP = '⌃';
const PAYMENT_METHOD_OPTIONS = [
  ['cash', 'Cash'],
  ['cashapp', 'Cash App'],
  ['venmo', 'Venmo'],
  ['square_manual', 'Square Manual'],
];
const PAYMENT_METHOD_LABELS = new Map([
  ['square_on_file', 'Square on file'],
  ['square_manual', 'Square manual'],
  ['cash', 'Cash'],
  ['cashapp', 'Cash App'],
  ['venmo', 'Venmo'],
]);


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

function AvailabilityWindowPanel({
  onCreate,
  startLabel,
  endLabel,
  invalidMessage,
  successMessage,
  errorMessage,
  submitLabel,
  busyLabel,
  includeNote = false,
}) {
  const initialRows = useMemo(() => buildInitialBlockRows(), []);
  const [start, setStart] = useState(initialRows.start);
  const [end, setEnd] = useState(initialRows.end);
  const [note, setNote] = useState('');
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
      setMessage({ type: 'error', text: invalidMessage });
      return;
    }

    setBusy(true);
    try {
      await onCreate({ startAt: startDate.toISOString(), endAt: endDate.toISOString(), note: note.trim() || null });
      setMessage({ type: 'success', text: successMessage });
      setNote('');
    } catch (error) {
      setMessage({ type: 'error', text: error.message || errorMessage });
    } finally {
      setBusy(false);
    }
  };

  return <form className="add-block-panel" onSubmit={submit}>
    <BlockDateTimeRow label={startLabel} value={start} months={months} datesByMonth={datesByMonth} timeOptions={timeOptions} onChange={setStart} />
    <BlockDateTimeRow label={endLabel} value={end} months={months} datesByMonth={datesByMonth} timeOptions={timeOptions} onChange={setEnd} />
    {includeNote && <label className="availability-note-field">Note / reason (optional)<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Example: Friday openings" /></label>}
    {isInvalid && <p className="admin-message error" role="alert">{invalidMessage}</p>}
    {message.text && <p className={`admin-message ${message.type}`} role="status">{message.text}</p>}
    <button className="btn primary" type="submit" disabled={busy || isInvalid}>{busy ? busyLabel : submitLabel}</button>
  </form>;
}

function AddBlockPanel({ onCreate }) {
  return <AvailabilityWindowPanel
    onCreate={async (payload) => onCreate({ ...payload, reason: 'Admin block' })}
    startLabel="Block start"
    endLabel="Block end"
    invalidMessage="Block end must be after block start."
    successMessage="Blocked time created."
    errorMessage="Unable to create blocked time."
    submitLabel="Create Block"
    busyLabel="Creating…"
  />;
}

function AddAvailabilityPanel({ onCreate }) {
  return <AvailabilityWindowPanel
    onCreate={onCreate}
    startLabel="Availability start"
    endLabel="Availability end"
    invalidMessage="Availability end must be after availability start."
    successMessage="Additional availability created."
    errorMessage="Unable to create additional availability."
    submitLabel="Create Availability"
    busyLabel="Creating…"
    includeNote
  />;
}

const appointmentDateFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
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


function getEstimatedTotalDollars(appointment) {
  const numeric = Number(appointment?.estimated_total_min);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;

  const parsed = Number(String(appointment?.estimated_total_text || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatDollarAmount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return '';
  return `$${numeric.toFixed(2)}`;
}

function formatEstimatedTotal(appointment) {
  const estimatedTotalText = String(appointment.estimated_total_text || '').trim();
  if (estimatedTotalText) {
    const normalizedText = estimatedTotalText.replace(/^estimated total(?:\s+(?:is|starts at))?\s*/i, '').trim();
    return normalizedText || estimatedTotalText;
  }

  const numeric = getEstimatedTotalDollars(appointment);
  if (!Number.isFinite(numeric)) return 'Estimated total unavailable';

  return formatDollarAmount(numeric);
}

function formatEstimatedDuration(minutes) {
  const totalMinutes = Number(minutes);
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return 'Estimated duration unavailable';

  const roundedMinutes = Math.round(totalMinutes);
  const hours = Math.floor(roundedMinutes / 60);
  const remainderMinutes = roundedMinutes % 60;

  if (!hours) return `${remainderMinutes} min`;

  const hourLabel = `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  if (!remainderMinutes) return hourLabel;
  return `${hourLabel} ${remainderMinutes} min`;
}

function getAppointmentServiceNames(appointment) {
  return (appointment.appointment_services || [])
    .map((service) => service.service_name_snapshot || service.name || service.service_name)
    .filter(Boolean);
}

function getAppointmentBookingNotes(appointment, customer) {
  const appointmentCreatedAt = new Date(appointment.created_at).getTime();
  return (customer?.customer_notes || [])
    .filter((note) => String(note.source || 'booking').toLowerCase() === 'booking')
    .filter((note) => {
      const noteCreatedAt = new Date(note.created_at).getTime();
      return Number.isFinite(appointmentCreatedAt) && noteCreatedAt === appointmentCreatedAt;
    })
    .map((note) => String(note.note_text || '').trim())
    .filter(Boolean);
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

const SERVICE_PAYMENT_PILL_STATUSES = new Set(['pending_confirmation', 'pending', 'confirmed', 'completed']);

function normalizeAppointmentStatus(status) {
  return String(status || '').toLowerCase();
}

function normalizePaymentStatus(status) {
  return String(status || 'unpaid').toLowerCase();
}

function shouldShowServicePaymentPill(appointmentStatus, servicePaymentStatus) {
  const normalizedStatus = normalizeAppointmentStatus(appointmentStatus);
  if (!SERVICE_PAYMENT_PILL_STATUSES.has(normalizedStatus)) return false;
  return normalizePaymentStatus(servicePaymentStatus) !== 'paid';
}

function isLateFeeRelevantAppointment(appointment) {
  const normalizedStatus = normalizeAppointmentStatus(appointment?.status);
  if (!['cancelled', 'declined'].includes(normalizedStatus)) return false;
  if (!appointment?.cancelled_at || !appointment?.start_at) return false;

  const startMs = new Date(appointment.start_at).getTime();
  const cancelledMs = new Date(appointment.cancelled_at).getTime();
  const hoursBeforeStart = (startMs - cancelledMs) / (60 * 60 * 1000);

  return Number.isFinite(hoursBeforeStart) && hoursBeforeStart > 0 && hoursBeforeStart <= 24;
}

function shouldShowLateFeePill(appointment, lateFeeStatus) {
  if (!isLateFeeRelevantAppointment(appointment)) return false;
  return normalizePaymentStatus(lateFeeStatus) !== 'paid';
}

function isUnappliedNoShowFee(appointment) {
  return normalizeAppointmentStatus(appointment?.status) === 'no_show'
    && normalizePaymentStatus(appointment?.no_show_fee_status) === 'unpaid';
}


function shouldShowNoShowFeePill(appointmentStatus, noShowFeeStatus) {
  const normalizedStatus = normalizeAppointmentStatus(appointmentStatus);
  if (normalizedStatus !== 'no_show') return false;
  return normalizePaymentStatus(noShowFeeStatus) !== 'paid';
}

function getAppointmentPaymentPills(appointment, servicePaymentStatus) {
  const appointmentStatus = appointment?.status;
  const pills = [];

  if (shouldShowServicePaymentPill(appointmentStatus, servicePaymentStatus)) {
    pills.push({
      key: 'service-payment',
      label: 'Service payment',
      value: servicePaymentStatus,
      className: 'pill meta-pill',
    });
  }

  if (shouldShowLateFeePill(appointment, appointment?.late_fee_status)) {
    pills.push({
      key: 'late-fee',
      label: 'Late fee',
      value: appointment?.late_fee_status || 'unpaid',
      className: 'pill meta-pill appointment-pill-late-fee',
    });
  }

  if (shouldShowNoShowFeePill(appointmentStatus, appointment?.no_show_fee_status)) {
    pills.push({
      key: 'no-show-fee',
      label: 'No-show fee',
      value: appointment?.no_show_fee_status || 'unpaid',
      className: 'pill meta-pill appointment-pill-no-show-fee',
    });
  }

  return pills;
}

function formatInventoryQuantity(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '0';
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function getInventoryStatus(supply) {
  const quantity = Number(supply?.current_quantity || 0);
  const threshold = Number(supply?.low_threshold || 0);
  if (quantity <= threshold) return 'critical';
  if (quantity <= threshold * 1.5) return 'low';
  return 'healthy';
}

function inventoryStatusClassName(status) {
  return `pill inventory-status-pill inventory-status-${status}`;
}

function InventoryStatusPill({ status }) {
  return <span className={inventoryStatusClassName(status)}><span>Status</span>{status}</span>;
}

function formatInventorySource(source) {
  return String(source || '').replace(/_/g, ' ');
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


function isAddonService(service) {
  return service?.is_addon === true || service?.type === 'addon';
}

function displayServiceName(service) {
  const name = service?.name || '';
  return isAddonService(service) && !name.trim().endsWith('*') ? `${name}*` : name;
}

function serviceRequiresBase(service) {
  return isAddonService(service) || (Array.isArray(service?.requires_service_ids) && service.requires_service_ids.length > 0);
}

function parseCurrencyInput(value) {
  return value.replace(/[^0-9.]/g, '');
}

function parseCurrencyAmount(value) {
  const numeric = Number(parseCurrencyInput(String(value || '')));
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatEditableCurrencyInput(value) {
  const numeric = parseCurrencyAmount(value);
  return numeric > 0 ? formatDollarAmount(numeric) : '';
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

function getPaymentRecordTotals(records) {
  return records.reduce((totals, record) => {
    const sign = record.payment_direction === 'refund' ? -1 : 1;
    return {
      serviceCents: totals.serviceCents + (sign * Number(record.amount_cents || 0)),
      tipCents: totals.tipCents + (sign * Number(record.tip_amount_cents || 0)),
    };
  }, { serviceCents: 0, tipCents: 0 });
}

function deriveOperationalPaymentStatus(estimatedCents, paidServiceCents) {
  if (paidServiceCents <= 0) return 'unpaid';
  if (paidServiceCents < estimatedCents) return 'partially_paid';
  if (paidServiceCents === estimatedCents) return 'paid';
  return 'overpaid';
}

function formatPaymentStatus(status) {
  return String(status || 'unpaid').replace(/_/g, ' ');
}

function formatPaymentMethod(method) {
  return PAYMENT_METHOD_LABELS.get(method) || String(method || 'Unsupported historical method').replace(/_/g, ' ');
}

function getSavedCardDescription(customer) {
  const brand = String(customer?.card_brand || 'card').trim();
  const last4 = String(customer?.card_last4 || '').trim();
  return `${brand}${last4 ? ` ending in ${last4}` : ''}`;
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
  return DEFAULT_APPOINTMENT_STATUSES.has(normalizedStatus)
    || visibleOptionalStatuses.has(normalizedStatus)
    || isUnappliedNoShowFee(appointment);
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


function PaginationControls({ label, currentPage, pageCount, onPrevious, onNext }) {
  if (pageCount <= 1) return null;

  return <div className="appointment-pagination" aria-label={label}>
    <button className="admin-secondary-button" type="button" onClick={onPrevious} disabled={currentPage === 0} aria-label="Previous page">‹</button>
    <span>Page {currentPage + 1} of {pageCount}</span>
    <button className="admin-secondary-button" type="button" onClick={onNext} disabled={currentPage >= pageCount - 1} aria-label="Next page">›</button>
  </div>;
}

function DashboardSection({ id, className = '', title, meta = '', actions = null, open, onToggle, alwaysContent = null, children }) {
  const expanded = Boolean(open);

  return <section id={id} className={`admin-section dashboard-section ${className}${expanded ? ' expanded' : ''}`}>
    <div className="dashboard-section-card card">
      <div className="dashboard-section-header">
        <button type="button" className="dashboard-section-title" onClick={onToggle} aria-expanded={expanded} aria-controls={`${id}-panel`}>
          <span>{title}{meta ? <span className="dashboard-section-meta"> {meta}</span> : null}</span>
        </button>
        <div className="dashboard-section-header-actions">
          {actions}
          <button type="button" className="appointment-arrow dashboard-section-chevron" onClick={onToggle} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${title}`} aria-expanded={expanded}>{expanded ? CHEVRON_UP : CHEVRON_DOWN}</button>
        </div>
      </div>
      {alwaysContent && <div className="dashboard-section-persistent-content">{alwaysContent}</div>}
      {expanded && <div id={`${id}-panel`} className="dashboard-section-content">{children}</div>}
    </div>
  </section>;
}

function getLocalDateKey(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return toLocalIsoDate(date);
}

function isFutureWindow(row) {
  const end = new Date(row?.end_at || row?.start_at).getTime();
  return Number.isFinite(end) && end >= Date.now();
}

function monthBounds(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { start, end };
}

function filterCustomersBySearch(customers, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return customers;
  return customers.filter((customer) => [
    `${customer.first_name || ''} ${customer.last_name || ''}`,
    customer.email,
    customer.phone,
  ].some((value) => String(value || '').toLowerCase().includes(needle)));
}


function formatMessageTimestamp(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function isSmsThreadEnabled(preference) {
  return ['sms', 'both'].includes(String(preference || 'both').toLowerCase());
}

function isSmsThreadMessage(message) {
  const channel = String(message?.channel || '').toLowerCase();
  return channel === 'sms' || channel === 'both' || message?.status === 'failed';
}

function getAppointmentNotificationWarnings(appointment) {
  return (appointment.client_messages || [])
    .filter((message) => message.status === 'failed')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function MessageThread({ customer, appointment = null }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState({ type: '', text: '' });
  const threadRef = useRef(null);
  const smsEnabled = isSmsThreadEnabled(customer?.communication_preference);
  const targetPayload = appointment?.id ? { appointmentId: appointment.id } : { customerId: customer?.id };
  const visibleMessages = messages.filter(isSmsThreadMessage);
  const hasThreadOverflow = visibleMessages.length > 6;

  const loadMessages = async () => {
    if (!smsEnabled || (!customer?.id && !appointment?.id)) return;
    setLoading(true);
    setNotice({ type: '', text: '' });
    try {
      const data = await fetchClientMessages(targetPayload);
      setMessages(data.messages || []);
    } catch (error) {
      setNotice({ type: 'error', text: error.message || 'Unable to load SMS messages.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setMessages([]);
    setDraft('');
    setExpanded(false);
    if (!smsEnabled) {
      setLoading(false);
      setNotice({ type: '', text: '' });
      return;
    }
    loadMessages();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id, appointment?.id, smsEnabled]);

  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [visibleMessages.length, expanded]);

  if (!smsEnabled) {
    return <section className="message-thread-card sms-opt-out-card" aria-label={`SMS messaging unavailable for ${customer?.first_name || 'customer'}`}>
      <div className="message-thread-head">
        <div>
          <h4>SMS Messages</h4>
          <p className="muted">Email communication happens outside the app.</p>
        </div>
      </div>
      <div className="sms-opt-out-message" role="note">
        <p>This customer has opted out of SMS communications and requested communication by email only.</p>
        <p>Please contact them directly at: <a href={customer?.email ? `mailto:${customer.email}` : undefined}>{customer?.email || 'No email on file'}</a></p>
        <p>Automated appointment emails will still be delivered normally.</p>
      </div>
      <p className="muted message-helper-text">Customers who opt out of SMS must be contacted directly through email.</p>
    </section>;
  }

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
      setNotice({ type: result.failures?.length ? 'error' : 'success', text: result.sent?.sms ? 'SMS sent.' : 'SMS message saved, but delivery was unavailable.' });
    } catch (error) {
      setNotice({ type: 'error', text: error.message || 'Unable to send SMS.' });
    } finally {
      setBusy(false);
    }
  };

  return <section className={`message-thread-card${expanded ? ' enlarged' : ''}`} aria-label={`SMS message history with ${customer?.first_name || 'customer'}`}>
    <div className="message-thread-head">
      <div>
        <h4>SMS Messages</h4>
        <p className="muted">In-app messaging sends SMS only. Email communication happens outside the app.</p>
        <p className="muted message-helper-text">Customers who opt out of SMS must be contacted directly through email.</p>
      </div>
      <div className="message-thread-actions">
        {hasThreadOverflow && <button type="button" className="message-thread-expand" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Shrink' : 'Enlarge'}</button>}
        {expanded && <button type="button" className="message-thread-close" onClick={() => setExpanded(false)} aria-label="Close enlarged SMS message thread">×</button>}
      </div>
    </div>

    <div className="message-thread-scroll" ref={threadRef}>
      {loading && <p className="muted">Loading SMS messages…</p>}
      {!loading && !visibleMessages.length && <p className="muted empty-thread">No SMS history yet.</p>}
      {visibleMessages.map((message) => {
        const outbound = message.direction === 'admin_to_customer';
        return <div key={message.id} className={`message-bubble-row ${outbound ? 'outbound' : 'inbound'}`}>
          <div className="message-bubble">
            <p>{message.body}</p>
            <span>{outbound ? 'Admin' : 'Client'} • SMS • {formatMessageTimestamp(message.created_at)}</span>
          </div>
        </div>;
      })}
    </div>

    <form className="message-compose" onSubmit={submit}>
      <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write an SMS…" rows={2} />
      <button className="btn primary" type="submit" disabled={busy || !draft.trim()}>{busy ? 'Sending…' : 'Send SMS'}</button>
    </form>
    {notice.text && <p className={`admin-message ${notice.type}`} role="status">{notice.text}</p>}
  </section>;
}

function AdminManualAppointmentPanel({ services, selectedDate, onSelectDate, onCreated }) {
  const [selectedServices, setSelectedServices] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [selectedTime, setSelectedTime] = useState('');
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', email: '', note: '', communicationPreference: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const selected = services.filter((item) => selectedServices.includes(item.id));
  const totalMin = selected.reduce((sum, item) => sum + Number(item.price_min_numeric || 0), 0);
  const duration = selected.reduce((sum, item) => sum + Number(item.duration_minutes || 0), 0);
  const bookableDates = useMemo(() => availability.filter((item) => item.available && item.date && Array.isArray(item.times) && item.times.length > 0).map((item) => item.date), [availability]);
  const hasSelectedDate = selectedDate && bookableDates.includes(selectedDate);
  const times = useMemo(() => availability.find((item) => item.date === selectedDate)?.times || [], [availability, selectedDate]);
  useEffect(() => {
    if (!selectedServices.length) {
      setAvailability([]);
      setSelectedTime('');
      return;
    }
    fetchAvailability(selectedServices).then((data) => setAvailability(data.dates || [])).catch(() => setAvailability([]));
  }, [selectedServices]);
  useEffect(() => {
    if (!selectedServices.length && selectedDate) onSelectDate('');
  }, [selectedDate, selectedServices.length, onSelectDate]);
  useEffect(() => {
    if (!selectedServices.length) return;
    if (!bookableDates.length) {
      if (selectedDate) onSelectDate('');
      return;
    }
    if (!selectedDate || !bookableDates.includes(selectedDate)) onSelectDate(bookableDates[0]);
  }, [bookableDates, onSelectDate, selectedDate, selectedServices.length]);
  useEffect(() => {
    if (selectedTime && !times.includes(selectedTime)) setSelectedTime('');
  }, [selectedTime, times]);
  const submit = async (event) => {
    event.preventDefault();
    if (!form.communicationPreference) {
      setError('Please select a communication preference.');
      return;
    }
    if (!selectedDate || !selectedTime) {
      setError('Please select an available date and time.');
      return;
    }
    setBusy(true); setError(''); setSuccess('');
    try {
      await createAdminAppointment({ ...form, serviceIds: selectedServices, startAt: new Date(`${selectedDate}T${selectedTime}:00`).toISOString() });
      setSuccess('Appointment created and confirmed.');
      onCreated();
    } catch (e) { setError(e.message || 'Unable to create appointment.'); } finally { setBusy(false); }
  };
  return <form className="add-block-panel" onSubmit={submit}>
    <h3>Manual appointment</h3>
    <p className="muted">Select services, choose an available time, then add customer details.</p>
    <div className="service-grid">{services.filter((service) => service.active !== false).map((service) => <label key={service.id} className="service-check"><input type="checkbox" checked={selectedServices.includes(service.id)} onChange={() => setSelectedServices((prev) => prev.includes(service.id) ? prev.filter((id) => id !== service.id) : [...prev, service.id])} />{service.name}</label>)}</div>
    <p className="muted">Estimated total starts at ${totalMin.toFixed(2)} • {duration} min</p>
    <label>Date<select required disabled={!selectedServices.length || !bookableDates.length} value={hasSelectedDate ? selectedDate : ''} onChange={(e) => { setSelectedTime(''); onSelectDate(e.target.value); }}><option value="">{selectedServices.length ? (bookableDates.length ? 'Select date' : 'No dates available') : 'Select services first'}</option>{bookableDates.map((date) => <option key={date} value={date}>{new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</option>)}</select></label>
    <label>Time<select required disabled={!hasSelectedDate || !times.length} value={selectedTime} onChange={(e) => setSelectedTime(e.target.value)}><option value="">{hasSelectedDate ? 'Select time' : 'Select date first'}</option>{times.map((time) => <option key={time} value={time}>{time}</option>)}</select></label>
    <label>First name<input required value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} /></label>
    <label>Last name<input required value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} /></label>
    <label>Phone<input required value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></label>
    <label>Email<input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></label>
    <fieldset className="communication-preference-group">
      <legend>Communication preference</legend>
      <label className="service-check"><input type="radio" name="admin-communication-preference" value="sms" checked={form.communicationPreference === 'sms'} onChange={(e) => setForm((f) => ({ ...f, communicationPreference: e.target.value }))} /> SMS</label>
      <label className="service-check"><input type="radio" name="admin-communication-preference" value="email" checked={form.communicationPreference === 'email'} onChange={(e) => setForm((f) => ({ ...f, communicationPreference: e.target.value }))} /> Email</label>
      <label className="service-check"><input type="radio" name="admin-communication-preference" value="both" checked={form.communicationPreference === 'both'} onChange={(e) => setForm((f) => ({ ...f, communicationPreference: e.target.value }))} /> Both</label>
      <p className="muted"><a href="/privacy-policy" target="_blank" rel="noreferrer">View communication/privacy policies</a></p>
    </fieldset>
    <label>Note<textarea value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></label>
    <button className="btn" disabled={busy}>{busy ? 'Creating...' : 'Create appointment'}</button>
    {error && <p className="admin-message error">{error}</p>}
    {success && <p className="admin-message success">{success}</p>}
  </form>;
}

function AppointmentCard({ appointment, customer, onRefresh }) {
  const estimatedTotalDollars = getEstimatedTotalDollars(appointment);
  const defaultServiceAmount = formatDollarAmount(estimatedTotalDollars);
  const defaultLateFeeAmount = Number.isFinite(estimatedTotalDollars) ? formatDollarAmount((estimatedTotalDollars * DEFAULT_LATE_FEE_PERCENT) / 100) : '';
  const defaultNoShowFeeAmount = Number.isFinite(estimatedTotalDollars) ? formatDollarAmount((estimatedTotalDollars * DEFAULT_NO_SHOW_FEE_PERCENT) / 100) : '';
  const [expanded, setExpanded] = useState(false);
  const [serviceAmount, setServiceAmount] = useState(defaultServiceAmount);
  const [lateFeeAmount, setLateFeeAmount] = useState(defaultLateFeeAmount);
  const [noShowFeeAmount, setNoShowFeeAmount] = useState(defaultNoShowFeeAmount);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentDirection, setPaymentDirection] = useState('payment');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentTip, setPaymentTip] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [actionNotice, setActionNotice] = useState({ type: '', text: '' });
  const [actionBusy, setActionBusy] = useState(false);
  const [showChargeOnFileModal, setShowChargeOnFileModal] = useState(false);
  const chargeOnFileSubmittingRef = useRef(false);

  const events = appointment.appointment_financial_events || [];
  const paymentRecords = appointment.appointment_payment_records || [];
  const sortedPaymentRecords = [...paymentRecords].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const paymentTotals = getPaymentRecordTotals(paymentRecords);
  const estimatedCents = Math.round(Number(estimatedTotalDollars || 0) * 100);
  const remainingCents = estimatedCents - paymentTotals.serviceCents;
  const chargeableRemainingCents = Math.max(0, remainingCents);
  const defaultPaymentAmount = formatDollarAmount(Math.max(0, remainingCents) / 100);
  const defaultRefundAmount = formatDollarAmount(Math.max(0, paymentTotals.serviceCents) / 100);
  const defaultOperationalAmount = paymentDirection === 'refund' ? defaultRefundAmount : defaultPaymentAmount;
  const operationalPaymentStatus = deriveOperationalPaymentStatus(estimatedCents, paymentTotals.serviceCents);
  const appointmentPaymentPills = getAppointmentPaymentPills(appointment, operationalPaymentStatus);
  const sortedEvents = [...events].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const serviceChargedCents = getSucceededEventTotal(events, 'service_charge');
  const serviceRefundedCents = getSucceededEventTotal(events, 'refund_service');
  const serviceRefundableCents = Math.max(0, serviceChargedCents - serviceRefundedCents);
  const serviceRefundableDollars = centsToDollars(serviceRefundableCents);
  const [serviceRefundAmount, setServiceRefundAmount] = useState(serviceRefundableDollars);
  const customerName = `${appointment.customers?.first_name || ''} ${appointment.customers?.last_name || ''}`.trim() || 'Customer';
  const appointmentDateTime = formatAppointmentDateTime(appointment.start_at);
  const appointmentServiceNames = getAppointmentServiceNames(appointment);
  const appointmentServiceList = appointmentServiceNames.length ? appointmentServiceNames.join(', ') : 'Service details unavailable';
  const estimatedTotal = formatEstimatedTotal(appointment);
  const estimatedDuration = formatEstimatedDuration(appointment.total_duration_minutes);
  const bookingNotes = getAppointmentBookingNotes(appointment, customer || appointment.customers);
  const notificationWarnings = getAppointmentNotificationWarnings(appointment);
  const hasSavedSquareCard = appointment.customers?.card_on_file_status === 'on_file' && !!appointment.customers?.square_card_id;
  const savedCardDescription = getSavedCardDescription(appointment.customers);
  const chargeOnFileAmount = centsToDollars(chargeableRemainingCents);
  const paymentsStatusPill = <span className={`pill payment-status-pill payment-status-${operationalPaymentStatus}`}>{formatPaymentStatus(operationalPaymentStatus)}</span>;

  const renderPaymentsPanel = () => <section className="appointment-payments-panel" aria-label="Payments">
    <div className="appointment-payments-head">
      <h4>Payments</h4>
      {paymentsStatusPill}
    </div>
    <div className="payment-summary-grid">
      <div><span>Estimated Total</span><strong>${centsToDollars(estimatedCents)}</strong></div>
      <div><span>Total Paid</span><strong>${centsToDollars(paymentTotals.serviceCents)}</strong></div>
      <div><span>Remaining Balance</span><strong>${centsToDollars(remainingCents)}</strong></div>
      <div><span>Tips</span><strong>${centsToDollars(paymentTotals.tipCents)}</strong></div>
    </div>
    {hasSavedSquareCard && <div className="payment-card-on-file-action">
      <button
        type="button"
        className="btn primary payment-card-on-file-button"
        disabled={actionBusy || chargeableRemainingCents <= 0}
        onClick={chargeOnFileFullAmount}
      >
        Charge On-File Card Full Amount
      </button>
      <p className="muted">Charges ${chargeOnFileAmount} to saved {savedCardDescription}. Tips stay separate.</p>
    </div>}
    {!!sortedPaymentRecords.length && <ul className="payment-record-list">{sortedPaymentRecords.map((record) => {
      const isRefund = record.payment_direction === 'refund';
      const sign = isRefund ? '-' : '';
      return <li key={record.id} className={isRefund ? 'refund-row' : 'payment-row'}>
        <span>{new Date(record.created_at).toLocaleString()} • {formatPaymentMethod(record.payment_method)} {isRefund && <em className="payment-history-badge">Refund</em>}</span>
        <strong>{sign}${centsToDollars(record.amount_cents)}{Number(record.tip_amount_cents || 0) > 0 ? ` + ${sign}$${centsToDollars(record.tip_amount_cents)} tip` : ''}</strong>
      </li>;
    })}</ul>}
    {!!sortedEvents.length && <details className="payment-event-history"><summary>Payment history ({sortedEvents.length})</summary><ul>{sortedEvents.map((event) => <li key={event.id}>{new Date(event.created_at).toLocaleString()} • {event.event_type} • ${centsToDollars(event.amount_cents)} • {event.status} • {event.initiated_by}</li>)}</ul></details>}
    <details className="payment-advanced-card">
      <summary className="payment-advanced-summary">Advanced Payment Actions</summary>
      <div className="payment-advanced-content">
        <div className="payment-entry-card">
          <div className="payment-form-grid">
            <label>Method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
              {PAYMENT_METHOD_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label>Type<select value={paymentDirection} onChange={(event) => setPaymentDirection(event.target.value)}>
              <option value="payment">Payment</option>
              <option value="refund">Refund</option>
            </select></label>
            <label>Amount<input type="text" inputMode="decimal" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} onBlur={formatChargeAmountField(setPaymentAmount)} placeholder="$0.00" /></label>
            <label>Tip<input type="text" inputMode="decimal" value={paymentTip} onChange={(event) => setPaymentTip(event.target.value)} onBlur={formatChargeAmountField(setPaymentTip)} placeholder="Optional" /></label>
            <label>Confirmation #<input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Optional" /></label>
            <label>Note<input value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} placeholder="Optional" /></label>
          </div>
          <button type="button" className="btn primary" disabled={actionBusy} onClick={applyPayment}>Apply Payment</button>
        </div>
        <div className="admin-action-grid">
          <button className="btn" disabled={actionBusy} onClick={chargeLateFee}>Charge late fee (defaulted to 25%)</button>
          <input
            type="text"
            inputMode="decimal"
            value={lateFeeAmount}
            onChange={(e) => setLateFeeAmount(e.target.value)}
            onBlur={formatChargeAmountField(setLateFeeAmount)}
            placeholder="Type late fee amount (e.g. $15.25)"
            aria-label="Late fee dollar amount"
          />
          <button className="btn" disabled={actionBusy} onClick={chargeNoShowFee}>Charge no-show fee (defaulted to 50%)</button>
          <input
            type="text"
            inputMode="decimal"
            value={noShowFeeAmount}
            onChange={(e) => setNoShowFeeAmount(e.target.value)}
            onBlur={formatChargeAmountField(setNoShowFeeAmount)}
            placeholder="Type no-show fee amount (e.g. $30.50)"
            aria-label="No-show fee dollar amount"
          />
          <button className="btn" disabled={actionBusy} onClick={chargeService}>Charge services (estimated total)</button>
          <input
            type="text"
            inputMode="decimal"
            value={serviceAmount}
            onChange={(e) => setServiceAmount(e.target.value)}
            onBlur={formatChargeAmountField(setServiceAmount)}
            placeholder="Type service amount (e.g. $85.00)"
            aria-label="Service charge dollar amount"
          />
        </div>
        <div className="admin-action-grid">
          <button className="btn" disabled={actionBusy} onClick={() => call(() => adminRefundAppointment({ appointmentId: appointment.id, target: 'late' }), 'Late fee refunded successfully.')}>Refund late fee</button>
          <button className="btn" disabled={actionBusy} onClick={() => call(() => adminRefundAppointment({ appointmentId: appointment.id, target: 'no_show' }), 'No-show fee refunded successfully.')}>Refund no-show fee</button>
          <button className="btn" disabled={actionBusy} onClick={() => call(() => adminRefundAppointment({ appointmentId: appointment.id, target: 'service' }), 'Service charge refunded successfully.')}>Refund services full</button>
          <button className="btn" disabled={actionBusy} onClick={() => call(() => adminRefundAppointment({ appointmentId: appointment.id, target: 'service', amount: parseCurrencyAmount(serviceRefundAmount) }), 'Service refund completed successfully.')}>Refund services</button>
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
      </div>
    </details>
  </section>;

  useEffect(() => {
    setServiceAmount(defaultServiceAmount);
    setLateFeeAmount(defaultLateFeeAmount);
    setNoShowFeeAmount(defaultNoShowFeeAmount);
  }, [appointment.id, defaultServiceAmount, defaultLateFeeAmount, defaultNoShowFeeAmount]);

  useEffect(() => {
    setServiceRefundAmount(serviceRefundableDollars);
  }, [appointment.id, serviceRefundableDollars]);

  useEffect(() => {
    setPaymentDirection('payment');
  }, [appointment.id]);

  useEffect(() => {
    setPaymentAmount(defaultOperationalAmount);
    setPaymentTip('');
    setPaymentReference('');
    setPaymentNote('');
  }, [appointment.id, defaultOperationalAmount, paymentDirection]);

  const call = async (fn, successText = 'Appointment action completed.') => {
    setActionBusy(true);
    setActionNotice({ type: '', text: '' });
    try {
      await fn();
      await onRefresh();
      setActionNotice({ type: 'success', text: successText });
    } catch (error) {
      setActionNotice({ type: 'error', text: error.message || 'Appointment action failed.' });
    } finally {
      setActionBusy(false);
    }
  };

  const chargeLateFee = () => call(
    () => adminChargeAppointment({ appointmentId: appointment.id, target: 'late', amount: parseCurrencyAmount(lateFeeAmount) }),
    'Late fee charged successfully.',
  );

  const chargeNoShowFee = () => call(
    () => adminChargeAppointment({ appointmentId: appointment.id, target: 'no_show', amount: parseCurrencyAmount(noShowFeeAmount) }),
    'No-show fee charged successfully.',
  );

  const chargeService = () => call(
    () => adminChargeAppointment({ appointmentId: appointment.id, target: 'service', amount: parseCurrencyAmount(serviceAmount) }),
    'Service charge completed successfully.',
  );

  const chargeOnFileFullAmount = () => {
    if (chargeableRemainingCents <= 0) {
      setActionNotice({ type: 'error', text: 'There is no remaining service balance to charge.' });
      return;
    }

    setShowChargeOnFileModal(true);
  };

  const cancelChargeOnFile = () => {
    if (actionBusy) return;
    setShowChargeOnFileModal(false);
  };

  const confirmChargeOnFile = async () => {
    if (actionBusy || chargeOnFileSubmittingRef.current) return;

    chargeOnFileSubmittingRef.current = true;
    try {
      await call(
        () => adminChargeAppointment({ appointmentId: appointment.id, target: 'service_remaining_balance' }),
        'Saved card charged successfully.',
      );
      setShowChargeOnFileModal(false);
    } finally {
      chargeOnFileSubmittingRef.current = false;
    }
  };

  const applyPayment = () => call(
    () => applyAppointmentPayment({
      appointmentId: appointment.id,
      paymentMethod,
      paymentDirection,
      amount: parseCurrencyAmount(paymentAmount),
      tip: parseCurrencyAmount(paymentTip),
      externalReference: paymentReference.trim() || null,
      note: paymentNote.trim() || null,
    }),
    paymentDirection === 'refund' ? 'Refund recorded successfully.' : 'Payment recorded successfully.',
  );

  const formatChargeAmountField = (setter) => (event) => {
    setter(formatEditableCurrencyInput(event.target.value));
  };

  return <article className={`card appointment-card${expanded ? ' expanded' : ''}`}>
    {!expanded && <div className="appointment-collapsed-row">
      <button type="button" className="appointment-toggle" onClick={() => setExpanded(true)} aria-expanded={expanded}>
        <span className="appointment-title">
          <strong>{appointmentDateTime}</strong>
          <span className="appointment-customer">{customerName}</span>
          <span className="appointment-booking-number">Booking #{formatBookingNumber(appointment.booking_request_number)}</span>
          {!!notificationWarnings.length && <span className="notification-warning-pill">Communication warning</span>}
        </span>
        <span className="appointment-toggle-status">
          <span className={statusClassName(appointment.status)}><span>Status</span>{formatAdminStatus(appointment.status)}</span>
        </span>
      </button>
      {normalizeAppointmentStatus(appointment.status) === 'pending_confirmation' && <button
        type="button"
        className="btn appointment-quick-confirm"
        disabled={actionBusy}
        onClick={() => call(() => setAppointmentStatus(appointment.id, 'confirmed'), 'Appointment marked Confirmed.')}
      >{actionBusy ? 'Confirming…' : 'Confirm'}</button>}
      <button type="button" className="appointment-arrow appointment-card-chevron" onClick={() => setExpanded(true)} aria-label="Expand appointment" aria-expanded={expanded}>{CHEVRON_DOWN}</button>
    </div>}

    {expanded && <div className="appointment-details">
      <button type="button" className="appointment-arrow appointment-card-chevron appointment-collapse-button" onClick={() => setExpanded(false)} aria-label="Collapse appointment" aria-expanded={expanded}>{CHEVRON_UP}</button>
      <div className="appointment-head">
        <div className="appointment-title appointment-title-expanded">
          <strong>{appointmentDateTime}</strong>
          <span className="appointment-customer">{customerName}</span>
          <span className="appointment-estimate-details">
            <span><b>Services:</b> {appointmentServiceList}</span>
            <span><b>Estimated Total:</b> {estimatedTotal}</span>
            <span><b>Estimated duration:</b> {estimatedDuration}</span>
            {!!bookingNotes.length && <span><b>Notes:</b> {bookingNotes.join('; ')}</span>}
          </span>
          <span className="appointment-booking-number">Booking #{formatBookingNumber(appointment.booking_request_number)}</span>
        </div>
        <div className="appointment-meta" aria-label="Booking status details">
          <span className={statusClassName(appointment.status)}><span>Status</span>{formatAdminStatus(appointment.status)}</span>
          {appointmentPaymentPills.map((pill) => <span key={pill.key} className={pill.className}><span>{pill.label}</span>{formatPaymentStatus(pill.value)}</span>)}
        </div>
      </div>
      <div className="admin-action-grid appointment-status-actions" aria-label="Appointment status actions">
        {['confirmed', 'declined', 'cancelled', 'completed', 'no_show'].map((status) => <button key={status} className="btn" disabled={actionBusy} onClick={() => call(() => setAppointmentStatus(appointment.id, status), `Appointment marked ${formatAdminStatus(status)}.`)}>{formatAdminStatus(status)}</button>)}
      </div>
      <p className="muted">Communication preference: {formatCommunicationPreference(appointment.customers?.communication_preference)} • Card: {appointment.customers?.card_on_file_status || 'missing'} {appointment.customers?.card_brand ? `(${appointment.customers.card_brand} ••••${appointment.customers.card_last4 || ''})` : ''}</p>

      <details className="appointment-messages-card">
        <summary>
          <span>SMS & Communication</span>
          {!!notificationWarnings.length && <span className="notification-warning-pill">{notificationWarnings.length} warning{notificationWarnings.length === 1 ? '' : 's'}</span>}
        </summary>
        <div className="appointment-messages-content">
          {!!notificationWarnings.length && <div className="admin-warning-banner" role="status">
            <strong>Customer communication may not have been delivered.</strong>
            <ul>{notificationWarnings.slice(0, 3).map((message) => <li key={message.id}>{message.body}</li>)}</ul>
          </div>}
          <MessageThread customer={appointment.customers} appointment={appointment} />
        </div>
      </details>

      <div className="desktop-payments-panel">{renderPaymentsPanel()}</div>
      <details className="mobile-payments-collapse">
        <summary className="mobile-payments-summary">
          <span className="mobile-payments-summary-title">Payments</span>
          <span className="mobile-payments-summary-status">{paymentsStatusPill}</span>
          <span className="mobile-payments-summary-balance"><span>Remaining</span><strong>${centsToDollars(remainingCents)}</strong></span>
          <span className="mobile-payments-summary-paid"><span>Paid</span><strong>${centsToDollars(paymentTotals.serviceCents)}</strong></span>
        </summary>
        {renderPaymentsPanel()}
      </details>

      {showChargeOnFileModal && <div className="admin-modal-overlay" role="presentation">
        <div className="admin-modal" role="dialog" aria-modal="true" aria-labelledby={`charge-card-title-${appointment.id}`}>
          <h3 className="admin-modal-title" id={`charge-card-title-${appointment.id}`}>Charge Saved Card?</h3>
          <div className="admin-modal-body">
            <p>Charge ${chargeOnFileAmount} to saved {savedCardDescription}?</p>
            <p className="muted">Tips are not included in this charge.</p>
          </div>
          <div className="admin-modal-actions">
            <button type="button" className="btn ghost" disabled={actionBusy} onClick={cancelChargeOnFile}>Cancel</button>
            <button type="button" className="btn primary" disabled={actionBusy} onClick={confirmChargeOnFile}>{actionBusy ? 'Charging...' : 'Confirm charge'}</button>
          </div>
        </div>
      </div>}

    </div>}

    {actionNotice.text && <p className={`admin-message appointment-action-notice ${actionNotice.type}`} role={actionNotice.type === 'error' ? 'alert' : 'status'}>{actionNotice.text}</p>}
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
        <span className="appointment-arrow" aria-hidden="true">{CHEVRON_DOWN}</span>
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
          <button type="button" className="appointment-arrow appointment-collapse-button" onClick={() => setExpanded(false)} aria-label="Collapse customer" aria-expanded={expanded}>{CHEVRON_UP}</button>
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

function InventorySection({ supplies, purchases, adjustments, open, onToggle, onRefresh, onSaveSupply, onPurchase, onManualAdjustment }) {
  const activeSupplies = supplies.filter((supply) => supply.active !== false);
  const criticalSupplies = activeSupplies.filter((supply) => getInventoryStatus(supply) === 'critical');

  return <DashboardSection
    id="admin-inventory"
    className="admin-section-inventory"
    title="Inventory"
    meta={`(${activeSupplies.length})`}
    open={open}
    onToggle={onToggle}
  >
    <div className="inventory-critical-preview" aria-label="Critical inventory supplies">
      <div className="inventory-critical-preview-head">
        <strong>Critical inventory preview</strong>
        <span className="muted">{criticalSupplies.length ? `${criticalSupplies.length} critical supply item(s)` : 'No critically low supplies'}</span>
      </div>
      {criticalSupplies.length ? criticalSupplies.map((supply) => <div className="inventory-critical-row" key={supply.id}>
        <strong>{supply.supply_name}</strong>
        <span>Qty {formatInventoryQuantity(supply.current_quantity)}</span>
        <span>Threshold {formatInventoryQuantity(supply.low_threshold)}</span>
        <InventoryStatusPill status="critical" />
      </div>) : <p className="muted">No critically low supplies.</p>}
    </div>
    <div className="inventory-expanded-content">
      <details className="inventory-nested-card">
        <summary>Supplies</summary>
        <InventorySuppliesTable supplies={supplies} onSaveSupply={onSaveSupply} onManualAdjustment={onManualAdjustment} />
      </details>
      <details className="inventory-nested-card">
        <summary>Purchases</summary>
        <InventoryPurchaseForm supplies={activeSupplies} purchases={purchases} onPurchase={onPurchase} />
      </details>
      <details className="inventory-nested-card">
        <summary>Adjustment History</summary>
        <InventoryAdjustmentHistory adjustments={adjustments} />
      </details>
      <div className="admin-section-actions"><button className="btn" type="button" onClick={onRefresh}>Refresh Inventory</button></div>
    </div>
  </DashboardSection>;
}

function InventorySuppliesTable({ supplies, onSaveSupply, onManualAdjustment }) {
  const [drafts, setDrafts] = useState({});
  const [openAdjustmentId, setOpenAdjustmentId] = useState('');
  const [adjustmentDrafts, setAdjustmentDrafts] = useState({});
  const [viewUnusedSupplies, setViewUnusedSupplies] = useState(false);
  const visibleSupplies = viewUnusedSupplies ? supplies : supplies.filter((supply) => supply.active !== false);
  const updateDraft = (id, patch) => setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  const updateAdjustmentDraft = (id, patch) => setAdjustmentDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const submitAdjustment = async (event, supply) => {
    event.preventDefault();
    const draft = adjustmentDrafts[supply.id] || {};
    const changeAmount = draft.changeAmount || '';
    const reason = draft.reason || '';
    await onManualAdjustment({ supplyId: supply.id, changeAmount, reason, allowNegative: Number(changeAmount) < 0 });
    setAdjustmentDrafts((prev) => ({ ...prev, [supply.id]: { changeAmount: '', reason: '' } }));
    setOpenAdjustmentId('');
  };

  return <>
    <label className="inventory-unused-toggle">
      <input type="checkbox" checked={viewUnusedSupplies} onChange={(event) => setViewUnusedSupplies(event.target.checked)} />
      <span>view unused supplies</span>
    </label>
    <div className="inventory-table-wrap"><table className="inventory-table">
    <thead><tr><th>Supply Name</th><th>Current Quantity</th><th>Low Threshold</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>{visibleSupplies.map((supply) => {
      const draft = drafts[supply.id] || {};
      const adjustmentDraft = adjustmentDrafts[supply.id] || {};
      const currentQuantity = draft.current_quantity ?? supply.current_quantity;
      const lowThreshold = draft.low_threshold ?? supply.low_threshold;
      const active = draft.active ?? supply.active !== false;
      const status = getInventoryStatus({ current_quantity: currentQuantity, low_threshold: lowThreshold });
      const adjustmentOpen = openAdjustmentId === supply.id;
      return [<tr key={supply.id}>
        <td><strong>{supply.supply_name}</strong>{!active && <span className="muted"> Unused</span>}</td>
        <td><input type="number" inputMode="decimal" step="1" value={currentQuantity} onChange={(e) => updateDraft(supply.id, { current_quantity: e.target.value })} /></td>
        <td><input type="number" min="0" step="0.01" value={lowThreshold} onChange={(e) => updateDraft(supply.id, { low_threshold: e.target.value })} /></td>
        <td><InventoryStatusPill status={status} /></td>
        <td><div className="inventory-actions">
          <AdminSecondaryButton onClick={() => onSaveSupply(supply.id, { current_quantity: currentQuantity, low_threshold: lowThreshold, active })}>Save Changes</AdminSecondaryButton>
          <AdminSecondaryButton onClick={() => setOpenAdjustmentId((previous) => previous === supply.id ? '' : supply.id)}>Manual adjustment</AdminSecondaryButton>
          <AdminSecondaryButton className={active ? 'danger' : ''} onClick={() => onSaveSupply(supply.id, { current_quantity: currentQuantity, low_threshold: lowThreshold, active: !active })}>{active ? 'Unused' : 'Restore'}</AdminSecondaryButton>
        </div></td>
      </tr>,
      adjustmentOpen && <tr key={`${supply.id}-adjustment`} className="inventory-adjustment-row">
        <td colSpan="5">
          <form className="inventory-adjustment-form" onSubmit={(event) => submitAdjustment(event, supply)}>
            <label>Adjustment Amount<input type="number" inputMode="decimal" step="any" value={adjustmentDraft.changeAmount || ''} onChange={(e) => updateAdjustmentDraft(supply.id, { changeAmount: e.target.value })} placeholder="Example: -0.5 or 2" required /></label>
            <label>Reason<input value={adjustmentDraft.reason || ''} onChange={(e) => updateAdjustmentDraft(supply.id, { reason: e.target.value })} placeholder="Example: damaged product, recount correction, spilled inventory" required /></label>
            <div className="inventory-actions">
              <AdminSecondaryButton type="submit">Log adjustment</AdminSecondaryButton>
              <AdminSecondaryButton onClick={() => setOpenAdjustmentId('')}>Cancel</AdminSecondaryButton>
            </div>
          </form>
        </td>
      </tr>];
    })}</tbody>
  </table>{!visibleSupplies.length && <p className="muted">No active supplies to show.</p>}</div>
  </>;
}

function InventoryPurchaseForm({ supplies, purchases, onPurchase }) {
  const [selectedSupplyId, setSelectedSupplyId] = useState('');
  const [newSupplyName, setNewSupplyName] = useState('');
  const [lowThreshold, setLowThreshold] = useState('1');
  const [quantity, setQuantity] = useState('0');
  const [totalCost, setTotalCost] = useState('0');
  const [receiptFile, setReceiptFile] = useState(null);
  const isNewSupply = selectedSupplyId === '__new__';
  const quantityHelpText = isNewSupply ? 'Initial stock quantity for this new supply.' : 'Amount added to the selected supply.';

  const submit = async (event) => {
    event.preventDefault();
    await onPurchase({ selectedSupplyId, newSupplyName, lowThreshold, quantity, totalCost, receiptFile });
    setSelectedSupplyId('');
    setNewSupplyName('');
    setLowThreshold('1');
    setQuantity('0');
    setTotalCost('0');
    setReceiptFile(null);
    event.currentTarget.reset();
  };

  return <><form className="inventory-purchase-form" onSubmit={submit}>
    <label>Existing Supply<select value={selectedSupplyId} onChange={(e) => setSelectedSupplyId(e.target.value)} required>
      <option value="">Choose supply</option>
      {supplies.map((supply) => <option key={supply.id} value={supply.id}>{supply.supply_name}</option>)}
      <option value="__new__">Add New Supply</option>
    </select></label>
    {isNewSupply && <>
      <label>Supply Name<input value={newSupplyName} onChange={(e) => setNewSupplyName(e.target.value)} required /></label>
      <label>Low Threshold<input type="number" min="0" step="0.01" value={lowThreshold} onChange={(e) => setLowThreshold(e.target.value)} required /></label>
    </>}
    <label>Quantity<input type="number" inputMode="decimal" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} required /><span className="muted">{quantityHelpText}</span></label>
    <label>Total Cost ($)<input className="no-number-spinner" type="number" inputMode="decimal" min="0" step="0.01" value={totalCost} onChange={(e) => setTotalCost(e.target.value)} required /></label>
    <label>Receipt Upload<input type="file" accept="image/*,application/pdf" onChange={(e) => setReceiptFile(e.target.files?.[0] || null)} /></label>
    <button className="btn primary" type="submit">Log purchase</button>
  </form>
  <div className="inventory-history-list">
    {purchases.slice(0, 8).map((purchase) => <p key={purchase.id}><b>{purchase.inventory_supplies?.supply_name || 'Supply'}</b> +{formatInventoryQuantity(purchase.quantity_increment)} • ${Number(purchase.total_cost || 0).toFixed(2)} • {new Date(purchase.created_at).toLocaleString()}{purchase.inventory_receipt_attachments?.length ? ' • receipt attached' : ''}</p>)}
    {!purchases.length && <p className="muted">No purchases logged yet.</p>}
  </div></>;
}

function InventoryAdjustmentHistory({ adjustments }) {
  return <div className="inventory-table-wrap"><table className="inventory-table">
    <thead><tr><th>Timestamp</th><th>Supply</th><th>Change</th><th>Resulting Quantity</th><th>Source</th></tr></thead>
    <tbody>{adjustments.map((log) => <tr key={log.id}>
      <td>{new Date(log.created_at).toLocaleString()}</td>
      <td>{log.inventory_supplies?.supply_name || 'Supply'}</td>
      <td>{formatInventoryQuantity(log.change_amount)}</td>
      <td>{formatInventoryQuantity(log.resulting_quantity)}</td>
      <td>{formatInventorySource(log.source_type)}{log.reason ? ` — ${log.reason}` : ''}</td>
    </tr>)}</tbody>
  </table>{!adjustments.length && <p className="muted">No inventory adjustments yet.</p>}</div>;
}

function hasValidInventoryAmount(value) {
  const text = String(value ?? '').trim();
  if (!text || !/^\d+(?:\.\d{1,3})?$/.test(text)) return false;
  const numeric = Number(text);
  return Number.isFinite(numeric) && numeric > 0;
}

function getSupplyName(supplies, supplyId) {
  return supplies.find((supply) => supply.id === supplyId)?.supply_name || 'Supply';
}

function ServiceSuppliesUsed({ service, supplies, mappings, onSaveMapping, onDeleteMapping }) {
  const activeSupplies = useMemo(() => supplies.filter((supply) => supply.active !== false), [supplies]);
  const [addDraft, setAddDraft] = useState({ supplyId: '', amountConsumed: '' });
  const [mappingDrafts, setMappingDrafts] = useState({});
  const [message, setMessage] = useState({ type: '', text: '' });
  const serviceMappings = useMemo(() => mappings.filter((mapping) => mapping.service_id === service.id), [mappings, service.id]);

  const updateMappingDraft = (mappingId, updates) => {
    setMappingDrafts((previous) => ({
      ...previous,
      [mappingId]: { ...(previous[mappingId] || {}), ...updates },
    }));
  };

  const validateDraft = ({ supplyId, amountConsumed, currentMappingId = null }) => {
    if (!supplyId) return 'Choose an active supply.';
    if (!activeSupplies.some((supply) => supply.id === supplyId)) return 'Choose an active supply.';
    if (!hasValidInventoryAmount(amountConsumed)) return 'Enter a positive quantity with up to 3 decimal places.';
    const duplicate = serviceMappings.some((mapping) => mapping.supply_id === supplyId && mapping.id !== currentMappingId);
    if (duplicate) return 'This supply is already mapped to this service.';
    return '';
  };

  const saveExisting = async (mapping) => {
    const draft = mappingDrafts[mapping.id] || {};
    const payload = {
      id: mapping.id,
      serviceId: service.id,
      supplyId: draft.supplyId ?? mapping.supply_id,
      amountConsumed: draft.amountConsumed ?? mapping.amount_consumed,
    };
    const validationMessage = validateDraft({ ...payload, currentMappingId: mapping.id });
    if (validationMessage) {
      setMessage({ type: 'error', text: validationMessage });
      return;
    }
    const saved = await onSaveMapping(payload);
    if (saved !== false) {
      setMappingDrafts((previous) => {
        const next = { ...previous };
        delete next[mapping.id];
        return next;
      });
      setMessage({ type: '', text: '' });
    }
  };

  const addMapping = async () => {
    const validationMessage = validateDraft(addDraft);
    if (validationMessage) {
      setMessage({ type: 'error', text: validationMessage });
      return;
    }
    const saved = await onSaveMapping({ serviceId: service.id, supplyId: addDraft.supplyId, amountConsumed: addDraft.amountConsumed });
    if (saved !== false) {
      setAddDraft({ supplyId: '', amountConsumed: '' });
      setMessage({ type: '', text: '' });
    }
  };

  return <section className="service-supplies-used" aria-label={`Supplies used by ${service.name || 'service'}`}>
    <div className="service-supplies-head">
      <h4>Supplies Used</h4>
      <p className="muted">Automatically deducted when this service is completed.</p>
    </div>
    <div className="service-supplies-list">
      {serviceMappings.map((mapping) => {
        const draft = mappingDrafts[mapping.id] || {};
        const selectedSupplyId = draft.supplyId ?? mapping.supply_id;
        const amountConsumed = draft.amountConsumed ?? mapping.amount_consumed;
        const selectedSupply = supplies.find((supply) => supply.id === selectedSupplyId);
        const selectedSupplyInactive = selectedSupply && selectedSupply.active === false;
        return <div className="service-supplies-row" key={mapping.id}>
          <select aria-label={`Supply used for ${service.name || 'service'}`} value={selectedSupplyId || ''} onChange={(e) => updateMappingDraft(mapping.id, { supplyId: e.target.value })}>
            {selectedSupplyInactive && <option value={selectedSupply.id} disabled>{selectedSupply.supply_name} (inactive)</option>}
            <option value="" disabled>Choose supply</option>
            {activeSupplies.map((supply) => <option key={supply.id} value={supply.id}>{supply.supply_name}</option>)}
          </select>
          <input aria-label={`Quantity of ${getSupplyName(supplies, selectedSupplyId)} consumed by ${service.name || 'service'}`} type="number" inputMode="decimal" min="0.001" step="0.001" placeholder="Qty" value={amountConsumed} onChange={(e) => updateMappingDraft(mapping.id, { amountConsumed: e.target.value })} />
          <div className="service-supplies-actions">
            <AdminSecondaryButton onClick={() => saveExisting(mapping)}>Save</AdminSecondaryButton>
            <AdminSecondaryButton className="danger" onClick={() => onDeleteMapping(mapping.id)}>Remove</AdminSecondaryButton>
          </div>
        </div>;
      })}
      {!serviceMappings.length && <p className="muted service-supplies-empty">No supplies mapped yet.</p>}
      <div className="service-supplies-row service-supplies-add-row">
        <select aria-label={`Add supply used for ${service.name || 'service'}`} value={addDraft.supplyId} onChange={(e) => setAddDraft((previous) => ({ ...previous, supplyId: e.target.value }))}>
          <option value="" disabled>Choose supply</option>
          {activeSupplies.map((supply) => <option key={supply.id} value={supply.id}>{supply.supply_name}</option>)}
        </select>
        <input aria-label={`Quantity consumed by ${service.name || 'service'}`} type="number" inputMode="decimal" min="0.001" step="0.001" placeholder="Qty" value={addDraft.amountConsumed} onChange={(e) => setAddDraft((previous) => ({ ...previous, amountConsumed: e.target.value }))} />
        <AdminSecondaryButton onClick={addMapping}>+ Add</AdminSecondaryButton>
      </div>
    </div>
    {message.text && <p className={`admin-message ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</p>}
  </section>;
}

export default function AdminPage() {
  const [session, setSession] = useState(null);
  const [services, setServices] = useState([]);
  const [testimonials, setTestimonials] = useState([]);
  const [gallery, setGallery] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [blockedTimes, setBlockedTimes] = useState([]);
  const [additionalAvailability, setAdditionalAvailability] = useState([]);
  const [selectedGalleryFiles, setSelectedGalleryFiles] = useState([]);
  const [galleryCaptionDraft, setGalleryCaptionDraft] = useState('');
  const [galleryUploadBusy, setGalleryUploadBusy] = useState(false);
  const [galleryMessage, setGalleryMessage] = useState({ type: '', text: '' });
  const testimonialOrderSaveToken = useRef(0);
  const galleryOrderSaveToken = useRef(0);
  const serviceOrderSaveToken = useRef(0);
  const [customerPage, setCustomerPage] = useState(0);
  const [appointmentCalendarMonth, setAppointmentCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedAppointmentDate, setSelectedAppointmentDate] = useState(() => toLocalIsoDate(new Date()));
  const [addAppointmentOpen, setAddAppointmentOpen] = useState(false);
  const [calendarAvailabilityDays, setCalendarAvailabilityDays] = useState(new Set());
  const [customerSearch, setCustomerSearch] = useState('');
  const [dashboardSectionsOpen, setDashboardSectionsOpen] = useState({
    blocks: false,
    additionalAvailability: false,
    customers: false,
    testimonials: false,
    services: false,
    inventory: false,
    gallery: false,
  });
  const [archivesOpen, setArchivesOpen] = useState(false);
  const [appointmentArchives, setAppointmentArchives] = useState([]);
  const [addBlockOpen, setAddBlockOpen] = useState(false);
  const [addAvailabilityOpen, setAddAvailabilityOpen] = useState(false);
  const [bookingAdminError, setBookingAdminError] = useState('');
  const [visibleOptionalAppointmentStatuses, setVisibleOptionalAppointmentStatuses] = useState(() => new Set());
  const [inventoryData, setInventoryData] = useState({ supplies: [], purchases: [], adjustments: [], mappings: [] });
  const [inventoryMessage, setInventoryMessage] = useState({ type: '', text: '' });

  const filteredAppointments = useMemo(() => appointments.filter((appointment) => shouldShowAppointment(appointment, visibleOptionalAppointmentStatuses)), [appointments, visibleOptionalAppointmentStatuses]);
  const sortedAppointments = useMemo(() => sortAppointmentsForAdmin(filteredAppointments), [filteredAppointments]);
  const appointmentsByDay = useMemo(() => sortedAppointments.reduce((map, appointment) => {
    const day = getLocalDateKey(appointment.start_at);
    if (!day) return map;
    map.set(day, [...(map.get(day) || []), appointment]);
    return map;
  }, new Map()), [sortedAppointments]);
  const dayAppointments = appointmentsByDay.get(selectedAppointmentDate) || [];
  const sortedCustomers = useMemo(() => sortCustomersAlphabetically(customers), [customers]);
  const searchedCustomers = useMemo(() => filterCustomersBySearch(sortedCustomers, customerSearch), [customerSearch, sortedCustomers]);
  const customerPageCount = Math.max(1, Math.ceil(searchedCustomers.length / CUSTOMERS_PER_PAGE));
  const currentCustomerPage = Math.min(customerPage, customerPageCount - 1);
  const customerPageStart = currentCustomerPage * CUSTOMERS_PER_PAGE;
  const customerPageEnd = Math.min(customerPageStart + CUSTOMERS_PER_PAGE, searchedCustomers.length);
  const pagedCustomers = searchedCustomers.slice(customerPageStart, customerPageEnd);
  const futureBlockedTimes = useMemo(() => blockedTimes.filter(isFutureWindow), [blockedTimes]);
  const futureAdditionalAvailability = useMemo(() => additionalAvailability.filter(isFutureWindow), [additionalAvailability]);
  const appointmentsByCustomerId = useMemo(() => {
    const grouped = new Map();
    appointments.forEach((appointment) => {
      if (!appointment.customer_id) return;
      grouped.set(appointment.customer_id, [...(grouped.get(appointment.customer_id) || []), appointment]);
    });
    return grouped;
  }, [appointments]);
  const customersById = useMemo(() => new Map(customers.map((customer) => [customer.id, customer])), [customers]);
  const calendarMeta = useMemo(() => {
    const { start, end } = monthBounds(appointmentCalendarMonth);
    const daysInMonth = end.getDate();
    const firstWeekday = start.getDay();
    return { daysInMonth, firstWeekday, label: appointmentCalendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
  }, [appointmentCalendarMonth]);
  const shortestActiveServiceId = useMemo(() => {
    const activeServices = services.filter((service) => service.active !== false && Number(service.duration_minutes) > 0);
    if (!activeServices.length) return null;
    return [...activeServices].sort((a, b) => Number(a.duration_minutes || 0) - Number(b.duration_minutes || 0))[0].id;
  }, [services]);

  const toggleOptionalAppointmentStatus = (status) => {
    setVisibleOptionalAppointmentStatuses((previous) => {
      const next = new Set(previous);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  useEffect(() => {
    if (customerPage > customerPageCount - 1) setCustomerPage(Math.max(0, customerPageCount - 1));
  }, [customerPage, customerPageCount]);

  useEffect(() => {
    setCustomerPage(0);
  }, [customerSearch]);

  const toggleDashboardSection = (sectionKey) => {
    setDashboardSectionsOpen((previous) => ({ ...previous, [sectionKey]: !previous[sectionKey] }));
  };

  const refreshBookingAdmin = async () => {
    setBookingAdminError('');
    try {
      const data = await fetchAdminAppointments();
      setAppointments(data.appointments || []);
      setCustomers(data.customers || []);
      setBlockedTimes(data.blockedTimes || []);
      setAdditionalAvailability(data.additionalAvailability || []);
    } catch (error) {
      setBookingAdminError('Appointment scheduling is temporarily unavailable. Please try again later.');
      throw error;
    }
  };

  const refreshAppointmentArchives = async () => {
    const data = await fetchArchivedAppointments();
    setAppointmentArchives(data.archives || []);
  };

  const refreshServiceList = async () => setServices(await fetchServices({ includeInactive: true }));
  const refreshGalleryList = async () => setGallery(await fetchGalleryItems());
  const refreshInventoryList = async () => {
    if (!hasSupabaseConfig) return;
    setInventoryData(await fetchInventoryAdminData());
  };

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
    Promise.all([fetchServices({ includeInactive: true }), fetchTestimonials(), fetchGalleryItems(), hasSupabaseConfig ? fetchInventoryAdminData() : Promise.resolve({ supplies: [], purchases: [], adjustments: [], mappings: [] })]).then(([serviceData, testimonialData, galleryData, inventoryAdminData]) => {
      setServices(serviceData);
      setTestimonials(testimonialData);
      setGallery(galleryData);
      setInventoryData(inventoryAdminData);
    });
  }, []);

  useEffect(() => {
    if (hasSupabaseConfig && !session) return;
    refreshBookingAdmin().catch(() => {});
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    if (!shortestActiveServiceId) {
      setCalendarAvailabilityDays(new Set());
      return;
    }
    fetchAvailability([shortestActiveServiceId]).then((data) => {
      if (cancelled) return;
      const availableDays = new Set((data?.dates || []).filter((row) => row.available).map((row) => row.date));
      setCalendarAvailabilityDays(availableDays);
    }).catch(() => {
      if (cancelled) return;
      setCalendarAvailabilityDays(new Set());
    });
    return () => {
      cancelled = true;
    };
  }, [shortestActiveServiceId]);

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
        await uploadGalleryImage(file, storageKey);
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



  const handleSaveInventorySupply = async (supplyId, payload) => {
    try {
      if (!hasSupabaseConfig) return;
      await saveInventorySupply(supplyId, payload);
      await refreshInventoryList();
      setInventoryMessage({ type: 'success', text: 'Supply saved.' });
    } catch (error) {
      setInventoryMessage({ type: 'error', text: error?.message || 'Unable to save supply.' });
    }
  };

  const handleManualInventoryAdjustment = async (payload) => {
    try {
      if (!hasSupabaseConfig) return;
      await createInventoryManualAdjustment(payload);
      await refreshInventoryList();
      setInventoryMessage({ type: 'success', text: 'Manual adjustment logged.' });
    } catch (error) {
      setInventoryMessage({ type: 'error', text: error?.message || 'Unable to log adjustment.' });
    }
  };

  const handleInventoryPurchase = async ({ selectedSupplyId, newSupplyName, lowThreshold, quantity, totalCost, receiptFile }) => {
    try {
      if (!hasSupabaseConfig) return;
      const isNewSupply = selectedSupplyId === '__new__';
      let receiptStorageKey = null;
      if (receiptFile) {
        const extension = receiptFile.name.includes('.') ? receiptFile.name.split('.').pop()?.toLowerCase() : 'pdf';
        receiptStorageKey = `receipts/${Date.now()}-${crypto.randomUUID()}.${extension || 'pdf'}`;
        await uploadInventoryReceipt(receiptFile, receiptStorageKey);
      }
      await createInventoryPurchase({
        supplyId: isNewSupply ? null : selectedSupplyId,
        newSupplyName,
        startingQuantity: 0,
        lowThreshold,
        quantityIncrement: quantity,
        totalCost,
        receiptStorageKey,
        receiptFileName: receiptFile?.name || null,
        receiptContentType: receiptFile?.type || null,
      });
      await refreshInventoryList();
      setInventoryMessage({ type: 'success', text: 'Purchase logged and inventory updated.' });
    } catch (error) {
      setInventoryMessage({ type: 'error', text: error?.message || 'Unable to log purchase.' });
    }
  };

  const validateServiceInventoryMapping = (payload) => {
    const activeSupply = inventoryData.supplies.some((supply) => supply.id === payload.supplyId && supply.active !== false);
    if (!activeSupply) return 'Choose an active supply.';
    if (!hasValidInventoryAmount(payload.amountConsumed)) return 'Enter a positive quantity with up to 3 decimal places.';
    const duplicate = inventoryData.mappings.some((mapping) => mapping.service_id === payload.serviceId && mapping.supply_id === payload.supplyId && mapping.id !== payload.id);
    if (duplicate) return 'This supply is already mapped to this service.';
    return '';
  };

  const handleSaveServiceInventoryMapping = async (payload) => {
    const validationMessage = validateServiceInventoryMapping(payload);
    if (validationMessage) {
      setInventoryMessage({ type: 'error', text: validationMessage });
      return false;
    }

    try {
      if (!hasSupabaseConfig) return false;
      await saveServiceInventoryMapping(payload);
      await refreshInventoryList();
      setInventoryMessage({ type: 'success', text: 'Service inventory mapping saved.' });
      return true;
    } catch (error) {
      setInventoryMessage({ type: 'error', text: error?.message || 'Unable to save mapping.' });
      return false;
    }
  };

  const handleDeleteServiceInventoryMapping = async (mappingId) => {
    try {
      if (!hasSupabaseConfig) return false;
      await deleteServiceInventoryMapping(mappingId);
      await refreshInventoryList();
      setInventoryMessage({ type: 'success', text: 'Service inventory mapping removed.' });
      return true;
    } catch (error) {
      setInventoryMessage({ type: 'error', text: error?.message || 'Unable to remove mapping.' });
      return false;
    }
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

  const getBaseServiceRequirements = (serviceId, sourceServices = services) => sourceServices
    .filter((service) => service.id !== serviceId && service.active !== false && !isAddonService(service))
    .map((service) => service.id);

  const getBaseServiceRequirementNames = (serviceId, sourceServices = services) => sourceServices
    .filter((service) => service.id !== serviceId && service.active !== false && !isAddonService(service))
    .map((service) => service.name);

  const updateServiceRequiresBase = (serviceId, checked) => {
    setServices((previous) => previous.map((service) => {
      if (service.id !== serviceId) return service;
      return {
        ...service,
        type: checked ? 'addon' : 'base',
        requires_service_ids: checked ? getBaseServiceRequirements(serviceId, previous) : [],
        requires_service_names: checked ? getBaseServiceRequirementNames(serviceId, previous) : [],
      };
    }));
  };

  const toggleServiceActive = async (service) => {
    const nextActive = service.active === false;
    if (hasSupabaseConfig) {
      await updateRecord('services', service.id, { active: nextActive });
      await refreshServiceList();
      return;
    }
    setServices((previous) => previous.map((item) => (item.id === service.id ? { ...item, active: nextActive } : item)));
  };

  const saveService = async (service, idx) => {
    if (!hasSupabaseConfig) return;
    const priceText = formatServicePrice(service);
    const requiresBase = serviceRequiresBase(service);
    const requiredIds = requiresBase ? getBaseServiceRequirements(service.id) : [];
    const requiredNames = requiresBase ? getBaseServiceRequirementNames(service.id) : [];
    await updateRecord('services', service.id, {
      name: service.name,
      price_text: priceText,
      price_min_numeric: getServicePriceNumber(service),
      duration: `${service.duration_minutes} min`,
      duration_minutes: service.duration_minutes,
      is_variable_price: service.is_variable_price,
      description: service.description,
      type: requiresBase ? 'addon' : 'base',
      requires_service_ids: requiredIds,
      requires_service_names: requiredNames,
      active: service.active !== false,
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

    <section id="admin-appointments" className="admin-section admin-section-appointments dashboard-section expanded">
      <div className="dashboard-section-card card">
        <div className="dashboard-section-header always-open">
          <h2>Appointments</h2>
          <div className="dashboard-section-header-actions"><button className="btn" onClick={() => refreshBookingAdmin().catch(() => {})}>Refresh</button><button className="btn" onClick={() => downloadPaymentsCsv().catch((error) => setBookingAdminError(error.message || 'Unable to export payments.'))}>Export Payments CSV</button></div>
        </div>
        <div className="dashboard-section-content">
          {bookingAdminError && <p className="admin-message error" role="alert">{bookingAdminError}</p>}
          <div className="appointment-filter-panel" aria-label="Appointment status filters">
            <span className="appointment-filter-label">Show hidden statuses:</span>
            {OPTIONAL_APPOINTMENT_STATUSES.map((status) => <label key={status} className={`appointment-filter-pill${visibleOptionalAppointmentStatuses.has(status) ? ' active' : ''}`}>
              <input type="checkbox" checked={visibleOptionalAppointmentStatuses.has(status)} onChange={() => toggleOptionalAppointmentStatus(status)} />
              {formatAdminStatus(status)}
            </label>)}
          </div>
          <div className="appointment-list-toolbar">
            <strong>{calendarMeta.label}</strong>
            <div className="dashboard-section-header-actions">
              <button type="button" className="admin-secondary-button" onClick={() => setAppointmentCalendarMonth((value) => new Date(value.getFullYear(), value.getMonth() - 1, 1))}>‹</button>
              <button type="button" className="admin-secondary-button" onClick={() => setAppointmentCalendarMonth((value) => new Date(value.getFullYear(), value.getMonth() + 1, 1))}>›</button>
              <button type="button" className="btn" onClick={() => setAddAppointmentOpen((v) => !v)}>Add Appointment</button>
            </div>
          </div>
          <div className="admin-appointments-calendar-grid">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="admin-appointments-weekday">{d}</div>)}
            {Array.from({ length: calendarMeta.firstWeekday }).map((_, idx) => <div key={`pad-${idx}`} />)}
            {Array.from({ length: calendarMeta.daysInMonth }).map((_, idx) => {
              const day = idx + 1;
              const date = new Date(appointmentCalendarMonth.getFullYear(), appointmentCalendarMonth.getMonth(), day);
              const dayKey = toLocalIsoDate(date);
              const count = (appointmentsByDay.get(dayKey) || []).length;
              const hasAvailability = calendarAvailabilityDays.has(dayKey);
              const isDisabled = !hasAvailability && count === 0;
              return <button key={dayKey} type="button" disabled={isDisabled} aria-disabled={isDisabled} className={`admin-appointments-day${selectedAppointmentDate === dayKey ? ' selected' : ''}${count ? ' has-appointments' : ''}${hasAvailability ? ' has-availability' : ''}${isDisabled ? ' is-unavailable' : ''}`} onClick={() => { if (!isDisabled) setSelectedAppointmentDate(dayKey); }}>
                <span>{day}</span>{count > 0 && <em>{count}</em>}
              </button>;
            })}
          </div>
          {addAppointmentOpen && <AdminManualAppointmentPanel services={services} selectedDate={selectedAppointmentDate} onSelectDate={setSelectedAppointmentDate} onCreated={async () => { setAddAppointmentOpen(false); await refreshBookingAdmin(); }} />}
          {!bookingAdminError && <div className="admin-list">{dayAppointments.map((appointment) => <AppointmentCard key={appointment.id} appointment={appointment} customer={customersById.get(appointment.customer_id)} onRefresh={refreshBookingAdmin} />)}</div>}
          {!bookingAdminError && !dayAppointments.length && <p className="muted">No appointments on {selectedAppointmentDate}.</p>}
          <AppointmentArchivePanel open={archivesOpen} archives={appointmentArchives} onToggle={() => setArchivesOpen((value) => !value)} onLoad={refreshAppointmentArchives} onDownload={downloadArchivedAppointment} />
        </div>
      </div>
    </section>

    <DashboardSection
      id="admin-blocks"
      className="admin-section-blocks"
      title="Blocked Times"
      open={dashboardSectionsOpen.blocks}
      onToggle={() => toggleDashboardSection('blocks')}
      actions={<button className="btn" type="button" onClick={(event) => { event.stopPropagation(); setAddBlockOpen((open) => !open); setDashboardSectionsOpen((previous) => ({ ...previous, blocks: true })); }}>{addBlockOpen ? 'Close Add Block' : 'Add Block'}</button>}
    >
      {addBlockOpen && <AddBlockPanel onCreate={async (payload) => {
        const result = await createBlockedTime(payload);
        if (result?.error) throw new Error(result.error);
        await refreshBookingAdmin();
      }} />}
      <div className="blocked-time-list">{futureBlockedTimes.map((block) => <div className="blocked-time-item" key={block.id}><span>{new Date(block.start_at).toLocaleString()} - {new Date(block.end_at).toLocaleString()} ({block.reason})</span> <AdminSecondaryButton onClick={async () => { await deleteBlockedTime(block.id); refreshBookingAdmin(); }}>Delete</AdminSecondaryButton></div>)}</div>
      {!futureBlockedTimes.length && <p className="muted">No upcoming blocked times.</p>}
    </DashboardSection>

    <DashboardSection
      id="admin-additional-availability"
      className="admin-section-blocks"
      title="Additional Times"
      open={dashboardSectionsOpen.additionalAvailability}
      onToggle={() => toggleDashboardSection('additionalAvailability')}
      actions={<button className="btn" type="button" onClick={(event) => { event.stopPropagation(); setAddAvailabilityOpen((open) => !open); setDashboardSectionsOpen((previous) => ({ ...previous, additionalAvailability: true })); }}>{addAvailabilityOpen ? 'Close Add Availability' : 'Add Availability'}</button>}
    >
      {addAvailabilityOpen && <AddAvailabilityPanel onCreate={async (payload) => {
        const result = await createAdditionalAvailability(payload);
        if (result?.error) throw new Error(result.error);
        await refreshBookingAdmin();
      }} />}
      <div className="blocked-time-list">{futureAdditionalAvailability.map((availability) => <div className="blocked-time-item" key={availability.id}><span>{new Date(availability.start_at).toLocaleString()} - {new Date(availability.end_at).toLocaleString()}{availability.note ? ` (${availability.note})` : ''}</span> <AdminSecondaryButton onClick={async () => { await deleteAdditionalAvailability(availability.id); refreshBookingAdmin(); }}>Delete</AdminSecondaryButton></div>)}</div>
      {!futureAdditionalAvailability.length && <p className="muted">No upcoming additional availability.</p>}
    </DashboardSection>

    <DashboardSection id="admin-customers" className="admin-section-customers" title="Customers" meta={`(${customers.length})`} open={dashboardSectionsOpen.customers} onToggle={() => toggleDashboardSection('customers')}>
      <label className="admin-search-field">Search customers<input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Name, email, or phone" /></label>
      <div className="admin-list customer-list">{pagedCustomers.map((customer) => <CustomerCard key={customer.id} customer={customer} appointments={appointmentsByCustomerId.get(customer.id) || []} />)}</div>
      {!searchedCustomers.length && <p className="muted">No customers match your search.</p>}
      <PaginationControls
        label="Customer pagination"
        currentPage={currentCustomerPage}
        pageCount={customerPageCount}
        onPrevious={() => setCustomerPage((page) => Math.max(0, page - 1))}
        onNext={() => setCustomerPage((page) => Math.min(customerPageCount - 1, page + 1))}
      />
    </DashboardSection>

    <DashboardSection
      id="admin-testimonials"
      className="admin-section-testimonials"
      title="Testimonials"
      meta={`(${testimonials.length})`}
      open={dashboardSectionsOpen.testimonials}
      onToggle={() => toggleDashboardSection('testimonials')}
    >
      <div className="admin-section-actions"><button className="btn" onClick={async () => { const item = { customer: 'Customer Name', quote: 'Editable testimonial quote.', display_order: testimonials.length + 1 }; const created = hasSupabaseConfig ? await createRecord('testimonials', item) : { ...item, id: crypto.randomUUID() }; setTestimonials((previous) => [...previous, created]); }}>Add Testimonial</button></div>
      <ReorderableList items={testimonials} onReorder={saveTestimonialVisualOrder} getItemLabel={(testimonial) => testimonial.customer || 'testimonial'} renderFields={(testimonial) => <><input value={testimonial.customer} onChange={(e) => setTestimonials((previous) => previous.map((item) => item.id === testimonial.id ? { ...item, customer: e.target.value } : item))} /><textarea value={testimonial.quote} onChange={(e) => setTestimonials((previous) => previous.map((item) => item.id === testimonial.id ? { ...item, quote: e.target.value } : item))} /><AdminSecondaryButton onClick={async () => hasSupabaseConfig && updateRecord('testimonials', testimonial.id, { customer: testimonial.customer, quote: testimonial.quote })}>Save</AdminSecondaryButton><AdminSecondaryButton className="danger" onClick={async () => { if (hasSupabaseConfig) await deleteRecord('testimonials', testimonial.id); setTestimonials((previous) => previous.filter((item) => item.id !== testimonial.id)); }}>Delete</AdminSecondaryButton></>} />
    </DashboardSection>

    <DashboardSection
      id="admin-services"
      className="admin-section-services"
      title="Services"
      meta={`(${services.length})`}
      open={dashboardSectionsOpen.services}
      onToggle={() => toggleDashboardSection('services')}
    >
      <div className="admin-section-actions"><button className="btn" onClick={async () => {
        const item = { name: 'New Service', price_text: '$0', price_min_numeric: 0, duration: '30 min', duration_minutes: 30, is_variable_price: false, description: 'Service details', type: 'base', requires_service_ids: [], requires_service_names: [], display_order: services.length + 1, active: true };
        const created = hasSupabaseConfig ? await createRecord('services', item) : { ...item, id: crypto.randomUUID() };
        if (hasSupabaseConfig) await refreshServiceList(); else setServices((previous) => [...previous, created]);
      }}>Add Service</button></div>
      <ReorderableList items={services} onReorder={saveServiceVisualOrder} getItemLabel={(service) => service.name || 'service'} renderFields={(service, idx) => <details className="service-collapsible-card">
        <summary>{service.name || 'Untitled service'}</summary>
        <div className="service-collapsible-content">
          {service.active === false && <p className="admin-service-status">Hidden from online booking and the public services list.</p>}
          <label>Service name<input value={service.name} onChange={(e) => setServices((previous) => previous.map((item) => item.id === service.id ? { ...item, name: e.target.value } : item))} /></label>
          <p className="muted admin-service-preview">Customers see: {displayServiceName(service)}</p>
          <label>Price<input type="number" min="0" step="0.01" value={getServicePriceNumber(service)} onChange={(e) => updateServicePrice(service.id, e.target.value)} /></label>
          <label>Duration (minutes)<input type="number" value={service.duration_minutes || 0} onChange={(e) => setServices((previous) => previous.map((item) => item.id === service.id ? { ...item, duration_minutes: Number(e.target.value), duration: `${e.target.value} min` } : item))} /></label>
          <label className="variable-price-row"><span>Variable price?</span><input type="checkbox" checked={Boolean(service.is_variable_price)} onChange={(e) => updateServiceVariablePrice(service.id, e.target.checked)} /></label>
          <label className="variable-price-row service-addon-row"><span>Requires base manicure/pedicure service</span><input type="checkbox" checked={serviceRequiresBase(service)} onChange={(e) => updateServiceRequiresBase(service.id, e.target.checked)} /></label>
          {serviceRequiresBase(service) && <p className="muted admin-service-help">This will book only with an active base service and will show an * to customers.</p>}
          <label>Description<textarea value={service.description} onChange={(e) => setServices((previous) => previous.map((item) => item.id === service.id ? { ...item, description: e.target.value } : item))} /></label>
          <ServiceSuppliesUsed
            service={service}
            supplies={inventoryData.supplies}
            mappings={inventoryData.mappings}
            onSaveMapping={handleSaveServiceInventoryMapping}
            onDeleteMapping={handleDeleteServiceInventoryMapping}
          />
          <AdminSecondaryButton onClick={() => saveService(service, idx)}>Save</AdminSecondaryButton>
          <AdminSecondaryButton className={service.active === false ? '' : 'danger'} onClick={() => toggleServiceActive(service)}>{service.active === false ? 'Show service' : 'Hide service'}</AdminSecondaryButton>
        </div>
      </details>} />
    </DashboardSection>

    <InventorySection
      supplies={inventoryData.supplies}
      purchases={inventoryData.purchases}
      adjustments={inventoryData.adjustments}
      open={dashboardSectionsOpen.inventory}
      onToggle={() => toggleDashboardSection('inventory')}
      onRefresh={() => refreshInventoryList().catch(() => setInventoryMessage({ type: 'error', text: 'Unable to refresh inventory.' }))}
      onSaveSupply={handleSaveInventorySupply}
      onPurchase={handleInventoryPurchase}
      onManualAdjustment={handleManualInventoryAdjustment}
    />
    {!!inventoryMessage.text && <p className={`admin-message ${inventoryMessage.type}`} role={inventoryMessage.type === 'error' ? 'alert' : 'status'}>{inventoryMessage.text}</p>}

    <DashboardSection
      id="admin-gallery"
      className="admin-section-gallery"
      title="Gallery"
      open={dashboardSectionsOpen.gallery}
      onToggle={() => toggleDashboardSection('gallery')}
      alwaysContent={<div className="gallery-upload-panel"><label htmlFor="gallery-file-picker">Select photo(s) to upload</label><input id="gallery-file-picker" type="file" accept="image/*" multiple onChange={(e) => { setSelectedGalleryFiles(Array.from(e.target.files || [])); setGalleryMessage({ type: '', text: '' }); }} /><label htmlFor="gallery-caption-input">Caption (optional)</label><input id="gallery-caption-input" placeholder="Caption for selected photo(s)" value={galleryCaptionDraft} onChange={(e) => setGalleryCaptionDraft(e.target.value)} /><button className="btn primary" onClick={uploadSelectedGalleryPhotos} disabled={galleryUploadBusy}>{galleryUploadBusy ? 'Uploading...' : 'Upload Selected Photos'}</button>{!!selectedGalleryFiles.length && <p className="muted">{selectedGalleryFiles.length} file(s) selected.</p>}{!!galleryMessage.text && <p className={galleryMessage.type === 'error' ? 'admin-message error' : 'admin-message success'}>{galleryMessage.text}</p>}</div>}
    >
      <ReorderableList items={gallery} onReorder={saveGalleryVisualOrder} getItemLabel={(galleryItem) => galleryItem.caption || 'gallery item'} renderFields={(galleryItem) => <div className="gallery-admin-item">{(galleryItem.imageUrl || galleryItem.local_path) ? <img src={galleryItem.imageUrl || galleryItem.local_path} alt="Gallery" /> : <div className="missing-image">No image</div>}<input placeholder="Caption" value={galleryItem.caption || ''} onChange={(e) => setGallery((previous) => previous.map((item) => item.id === galleryItem.id ? { ...item, caption: e.target.value } : item))} /><AdminSecondaryButton onClick={async () => { if (!hasSupabaseConfig) return; await updateRecord('gallery_items', galleryItem.id, { caption: galleryItem.caption || '' }); await refreshGalleryList(); }}>Save</AdminSecondaryButton><AdminSecondaryButton className="danger" onClick={async () => { if (hasSupabaseConfig) { await deleteGalleryImage(galleryItem.storage_key); await deleteRecord('gallery_items', galleryItem.id); await refreshGalleryList(); return; } setGallery((previous) => previous.filter((item) => item.id !== galleryItem.id)); }}>Delete</AdminSecondaryButton></div>} />
    </DashboardSection>
  </main>;
}
