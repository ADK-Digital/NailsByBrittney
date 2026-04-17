const SQUARE_API_BASE = process.env.SQUARE_API_BASE_URL || 'https://connect.squareup.com';
const SQUARE_VERSION = process.env.SQUARE_API_VERSION || '2025-10-16';

function hasSquareCredentials() {
  return Boolean(process.env.SQUARE_ACCESS_TOKEN && process.env.SQUARE_LOCATION_ID);
}

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
    'Square-Version': SQUARE_VERSION,
    'Content-Type': 'application/json',
  };
}

async function squareRequest(path, payload = {}) {
  const res = await fetch(`${SQUARE_API_BASE}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors?.length) {
    const msg = body.errors?.map((item) => item.detail || item.code).join('; ') || `Square request failed (${res.status})`;
    throw new Error(msg);
  }
  return body;
}

function canMock() {
  return process.env.SQUARE_ALLOW_MOCK === 'true' || process.env.NODE_ENV !== 'production';
}

export async function ensureSquareCustomer({ existingSquareCustomerId, firstName, lastName, email, phone, customerId, idempotencyKey }) {
  if (!hasSquareCredentials()) {
    if (!canMock()) throw new Error('Square is not configured.');
    return { squareCustomerId: existingSquareCustomerId || `mock-customer-${customerId}`, created: !existingSquareCustomerId };
  }

  if (existingSquareCustomerId) {
    return { squareCustomerId: existingSquareCustomerId, created: false };
  }

  const customerCreateIdempotencyKey = idempotencyKey || crypto.randomUUID();
  const response = await squareRequest('/v2/customers', {
    idempotency_key: customerCreateIdempotencyKey,
    given_name: firstName,
    family_name: lastName,
    email_address: email,
    phone_number: phone,
    reference_id: customerId,
  });

  return { squareCustomerId: response.customer.id, created: true };
}

export async function storeCardOnFile({ squareCustomerId, cardToken, idempotencyKey }) {
  if (!cardToken) throw new Error('Card token is required.');

  if (!hasSquareCredentials()) {
    if (!canMock()) throw new Error('Square is not configured.');
    return {
      cardId: `mock-card-${idempotencyKey}`,
      cardBrand: 'VISA',
      cardLast4: '1111',
      status: 'on_file',
      created: true,
    };
  }

  const response = await squareRequest('/v2/cards', {
    idempotency_key: idempotencyKey,
    source_id: cardToken,
    card: { customer_id: squareCustomerId },
  });

  return {
    cardId: response.card.id,
    cardBrand: response.card.card_brand || null,
    cardLast4: response.card.last_4 || null,
    status: response.card.enabled ? 'on_file' : 'disabled',
    created: true,
  };
}

export async function disableCardOnFile({ cardId }) {
  if (!cardId) return;

  if (!hasSquareCredentials()) {
    if (!canMock()) throw new Error('Square is not configured.');
    return { disabled: true, mock: true };
  }

  await squareRequest(`/v2/cards/${cardId}/disable`, {});
  return { disabled: true };
}

export async function chargeCardOnFile({ squareCustomerId, squareCardId, amountCents, note, idempotencyKey }) {
  if (amountCents <= 0) throw new Error('Charge amount must be greater than zero.');

  if (!hasSquareCredentials()) {
    if (!canMock()) throw new Error('Square is not configured.');
    return {
      paymentId: `mock-payment-${idempotencyKey}`,
      status: 'COMPLETED',
      amountCents,
      receiptUrl: null,
      sourceType: 'mock',
    };
  }

  const response = await squareRequest('/v2/payments', {
    idempotency_key: idempotencyKey,
    customer_id: squareCustomerId,
    source_id: squareCardId,
    location_id: process.env.SQUARE_LOCATION_ID,
    autocomplete: true,
    amount_money: {
      amount: amountCents,
      currency: process.env.SQUARE_CURRENCY || 'USD',
    },
    note,
  });

  return {
    paymentId: response.payment.id,
    status: response.payment.status,
    amountCents: response.payment.amount_money?.amount || amountCents,
    receiptUrl: response.payment.receipt_url || null,
    sourceType: response.payment.source_type || null,
  };
}

export async function refundPayment({ paymentId, amountCents, reason, idempotencyKey }) {
  if (amountCents <= 0) throw new Error('Refund amount must be greater than zero.');
  // This helper performs linked refunds (via payment_id), so Square requires omitting location_id.
  if (!paymentId) throw new Error('Payment ID is required for linked refunds.');

  if (!hasSquareCredentials()) {
    if (!canMock()) throw new Error('Square is not configured.');
    return {
      refundId: `mock-refund-${idempotencyKey}`,
      status: 'COMPLETED',
      amountCents,
    };
  }

  const response = await squareRequest('/v2/refunds', {
    idempotency_key: idempotencyKey,
    payment_id: paymentId,
    amount_money: {
      amount: amountCents,
      currency: process.env.SQUARE_CURRENCY || 'USD',
    },
    reason,
  });

  return {
    refundId: response.refund.id,
    status: response.refund.status,
    amountCents: response.refund.amount_money?.amount || amountCents,
  };
}
