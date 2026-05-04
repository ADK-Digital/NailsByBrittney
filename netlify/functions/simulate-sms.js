import { json } from './_lib/supabaseAdmin.js';
import { handler as twilioInboundHandler } from './twilio-inbound.js';

function extractXmlMessage(xml = '') {
  const match = String(xml).match(/<Message>([\s\S]*?)<\/Message>/i);
  return match ? match[1] : '';
}

export const handler = async (event) => {
  if ((event.httpMethod || '').toUpperCase() !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const secret = event.headers?.['x-dev-secret'] || event.headers?.['X-Dev-Secret'];
  if (!process.env.DEV_SECRET || secret !== process.env.DEV_SECRET) {
    return json(401, { error: 'Unauthorized' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const from = String(payload.from || '').trim();
  const text = String(payload.text || '').trim();

  console.log('[simulate-sms] incoming text', { from, text });

  try {
    const twilioEvent = {
      body: new URLSearchParams({ From: from, Body: text }).toString(),
    };

    const result = await twilioInboundHandler(twilioEvent);
    const responseMessage = extractXmlMessage(result?.body || '');

    const looksInvalid = responseMessage.toLowerCase().startsWith('invalid command');
    if (looksInvalid) {
      console.log('[simulate-sms] parsed command', null);
      console.log('[simulate-sms] result', { error: 'Invalid command' });
      return json(400, { error: 'Invalid command' });
    }

    console.log('[simulate-sms] parsed command', text);
    console.log('[simulate-sms] result', responseMessage);
    return json(200, { response: responseMessage });
  } catch (error) {
    console.log('[simulate-sms] parsed command', text);
    console.log('[simulate-sms] result', { error: error.message });
    return json(500, { error: error.message });
  }
};
