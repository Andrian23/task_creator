import { ingestUpworkEvent } from '../lib/upwork.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (req.method === 'GET') {
    res.status(200).json({ ok: true });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    return;
  }
  try {
    const result = await ingestUpworkEvent(req.body);
    res.status(result.error ? 400 : 200).json(result);
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: 'UPWORK_EVENT_FAILED' });
  }
}
