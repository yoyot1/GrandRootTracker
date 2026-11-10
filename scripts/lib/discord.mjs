const API = 'https://discord.com/api/v10';
const MAX_IMAGE_BYTES = 4_500_000; // Claude accepts up to 5 MB per image

async function call(path, { token, method = 'GET', body, fetchImpl = fetch }) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetchImpl(API + path, {
      method,
      headers: {
        authorization: `Bot ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) {
      const info = await res.json().catch(() => ({}));
      await new Promise((r) => setTimeout(r, Math.ceil((info.retry_after ?? 1) * 1000) + 100));
      continue;
    }
    if (!res.ok) throw new Error(`Discord ${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }
  throw new Error(`Discord ${method} ${path}: still rate-limited after 5 tries`);
}

/** All messages newer than `after`, oldest first. `after` of null reads the whole channel. */
export async function fetchMessagesAfter({ channelId, after, token, fetchImpl }) {
  const all = [];
  let cursor = after ?? '0';
  for (;;) {
    const batch = await call(`/channels/${channelId}/messages?limit=100&after=${cursor}`, { token, fetchImpl });
    if (!batch.length) break;
    batch.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    all.push(...batch);
    cursor = batch[batch.length - 1].id;
    if (batch.length < 100) break;
  }
  return all;
}

export function imageAttachments(message) {
  return (message.attachments ?? []).filter(
    (a) => (a.content_type ?? '').startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(a.filename ?? ''),
  );
}

/**
 * Download an attachment as base64. Large screenshots are fetched through
 * Discord's media proxy at a reduced size so they fit the Claude API limit.
 */
export async function downloadImage(attachment, { fetchImpl = fetch } = {}) {
  const candidates = [];
  if (attachment.proxy_url && attachment.width && attachment.height) {
    const scale = Math.min(1, 1600 / attachment.width);
    const w = Math.round(attachment.width * scale);
    const h = Math.round(attachment.height * scale);
    const sep = attachment.proxy_url.includes('?') ? '&' : '?';
    candidates.push(`${attachment.proxy_url}${sep}format=webp&width=${w}&height=${h}`);
  }
  candidates.push(attachment.url);

  let lastError = null;
  for (const url of candidates) {
    try {
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_IMAGE_BYTES) throw new Error(`image is ${buf.length} bytes`);
      const mediaType = (res.headers.get('content-type') ?? attachment.content_type ?? 'image/png').split(';')[0];
      return { base64: buf.toString('base64'), mediaType, buffer: buf };
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Could not download ${attachment.filename}: ${lastError?.message}`);
}

export async function replyToMessage({ channelId, messageId, content, token, fetchImpl }) {
  return call(`/channels/${channelId}/messages`, {
    token,
    fetchImpl,
    method: 'POST',
    body: {
      content: content.slice(0, 1900),
      message_reference: { message_id: messageId, fail_if_not_exists: false },
      allowed_mentions: { parse: [] },
    },
  });
}
