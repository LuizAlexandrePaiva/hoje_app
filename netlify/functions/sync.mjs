// Função do Netlify: /api/sync, guardando os envelopes cifrados no Netlify Blobs.
import { getStore } from '@netlify/blobs';
import { handleSync } from '../lib/sync-core.mjs';

export default async (req) => handleSync(req, getStore({ name: 'hoje-sync', consistency: 'strong' }));

export const config = { path: '/api/sync' };
