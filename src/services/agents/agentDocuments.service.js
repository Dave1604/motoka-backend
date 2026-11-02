import { randomUUID } from 'crypto';
import { getSupabaseAdmin } from '../../config/supabase.js';

/**
 * Agents' NIN images. These are government IDs, so they live in a private bucket
 * (migration 118), unlike car-documents, and are only ever read through a
 * short-lived signed URL.
 */
const BUCKET = 'agent-documents';
const SIGNED_URL_SECONDS = 300;

const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export const NIN_COLUMNS = { front: 'nin_front_path', back: 'nin_back_path' };

export async function uploadAgentNin({ agentId, side, file }) {
  const path = `${agentId}/nin-${side}-${randomUUID()}.${EXTENSIONS[file.mimetype] || 'bin'}`;
  const { error } = await getSupabaseAdmin().storage
    .from(BUCKET)
    .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });
  if (error) throw new Error(`Failed to upload NIN ${side}: ${error.message}`);
  return path;
}

export async function removeAgentDocuments(paths) {
  if (paths.length === 0) return;
  const { error } = await getSupabaseAdmin().storage.from(BUCKET).remove(paths);
  if (error) throw new Error(`Failed to remove agent documents: ${error.message}`);
}

export async function signAgentDocument(path) {
  const { data, error } = await getSupabaseAdmin().storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) throw new Error(`Failed to sign agent document: ${error?.message}`);
  return data.signedUrl;
}
