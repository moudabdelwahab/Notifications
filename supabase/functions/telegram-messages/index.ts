/**
 * telegram-messages — reads chats and their recent history on demand.
 *
 * Actions:
 *   list-chats    {}                            -> { chats: [...] }
 *   get-messages  { chatId, limit? }            -> { messages: [...] }
 *
 * Nothing is stored. Each call opens a short-lived MTProto connection using the
 * user's Vault-held session, reads, and disconnects — so the browser never sees
 * the session and no copy of the user's conversations lands in the database.
 */
import { TelegramClient } from 'jsr:@mtcute/web@0.31.0'
import { MemoryStorage } from 'jsr:@mtcute/core@0.31.0'
import { convertFromTelethonSession } from 'jsr:@mtcute/convert@0.31.0'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const CHAT_LIMIT = 200
const DEFAULT_MESSAGE_LIMIT = 50
const MAX_MESSAGE_LIMIT = 100

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

interface Credentials {
  session_data: string | null
  api_id: string | null
  api_hash: string | null
}

/**
 * Normalises a peer onto the vocabulary the rest of the app uses.
 *
 * `peer.type` only distinguishes user from chat; the group/supergroup/channel
 * split lives on `peer.chatType`, which is undefined for users. Reading `type`
 * alone collapses broadcast channels into groups.
 */
function normaliseType(peer: any): 'group' | 'channel' | 'private' {
  switch (peer?.chatType ?? peer?.type) {
    case 'group':
    case 'supergroup':
      return 'group'
    case 'channel':
      return 'channel'
    default:
      return 'private'
  }
}

/**
 * `message.link` throws — not returns null — for chats that have no public
 * username, which is most private groups. Letting it propagate would fail the
 * whole request over a cosmetic field.
 */
function safeLink(message: any): string | null {
  try {
    return message.link ?? null
  } catch {
    return null
  }
}

async function loadCredentials(
  supabase: SupabaseClient,
  userId: string,
): Promise<Credentials | null> {
  const { data, error } = await supabase.rpc('get_telegram_credentials', { p_user_id: userId })
  if (error) {
    console.error('[CREDS] lookup failed:', error)
    return null
  }
  const row = Array.isArray(data) ? data[0] : data
  if (!row?.session_data || !row?.api_id || !row?.api_hash) return null
  return row as Credentials
}

/** Opens a connected, signed-in client. The caller must destroy it. */
async function openClient(creds: Credentials): Promise<TelegramClient> {
  const client = new TelegramClient({
    apiId: Number.parseInt(creds.api_id!, 10),
    apiHash: creds.api_hash!,
    storage: new MemoryStorage(),
    disableUpdates: true,
  })
  // Sessions are stored in Telethon's format for the Python worker.
  await client.importSession(convertFromTelethonSession(creds.session_data!))
  await client.connect()
  return client
}

function summarise(message: any): string {
  if (message.text) return message.text
  if (message.media) return `[${message.media.type ?? 'مرفق'}]`
  if (message.isService) return '[إجراء في المحادثة]'
  return ''
}

async function handleListChats(client: TelegramClient) {
  const chats: unknown[] = []

  for await (const dialog of client.iterDialogs({ limit: CHAT_LIMIT })) {
    const peer: any = (dialog as any).peer
    if (!peer) continue

    const last: any = (dialog as any).lastMessage
    chats.push({
      id: String(peer.id),
      title: peer.displayName ?? String(peer.id),
      type: normaliseType(peer),
      username: peer.username ?? null,
      isPinned: Boolean((dialog as any).isPinned),
      isArchived: Boolean((dialog as any).isArchived),
      isMuted: Boolean((dialog as any).isMuted),
      unreadCount: (dialog as any).unreadCount ?? 0,
      lastMessage: last
        ? {
            text: summarise(last),
            date: last.date?.toISOString?.() ?? null,
            outgoing: Boolean(last.isOutgoing),
          }
        : null,
    })
  }

  return json({ chats })
}

async function handleGetMessages(client: TelegramClient, body: Record<string, unknown>) {
  const chatIdRaw = String(body.chatId ?? '').trim()
  if (!chatIdRaw) return json({ error: 'chatId مطلوب' }, 400)

  const chatId = Number(chatIdRaw)
  if (!Number.isFinite(chatId)) return json({ error: 'chatId غير صالح' }, 400)

  const requested = Number(body.limit ?? DEFAULT_MESSAGE_LIMIT)
  const limit = Math.min(
    Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_MESSAGE_LIMIT,
    MAX_MESSAGE_LIMIT,
  )

  const peer = await client.resolvePeer(chatId)
  const messages: unknown[] = []

  for await (const message of client.iterHistory(peer, { limit })) {
    const m: any = message
    messages.push({
      id: m.id,
      text: summarise(m),
      date: m.date?.toISOString?.() ?? null,
      outgoing: Boolean(m.isOutgoing),
      senderName: m.sender?.displayName ?? 'غير معروف',
      senderId: m.sender?.id != null ? String(m.sender.id) : null,
      hasMedia: Boolean(m.media),
      mediaType: m.media?.type ?? null,
      isService: Boolean(m.isService),
      isReply: Boolean(m.replyToMessage),
      // mtcute builds a correct t.me link; do not hand-assemble one.
      link: safeLink(m),
    })
  }

  // iterHistory yields newest first; a thread reads oldest → newest.
  messages.reverse()
  return json({ messages })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'إعدادات Supabase غير مكتملة على الخادم' }, 500)
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'مطلوب تسجيل الدخول' }, 401)

  const { data: { user }, error: userError } = await supabase.auth.getUser(
    authHeader.replace(/^Bearer\s+/i, ''),
  )
  if (userError || !user) {
    return json({ error: 'جلسة الدخول غير صالحة. سجّل الدخول مرة أخرى.' }, 401)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'صيغة الطلب غير صحيحة' }, 400)
  }

  const creds = await loadCredentials(supabase, user.id)
  if (!creds) {
    return json({ error: 'لا يوجد حساب Telegram مربوط. أكمل الإعداد أولاً.' }, 400)
  }

  let client: TelegramClient | null = null
  try {
    client = await openClient(creds)

    const action = String(body.action ?? '')
    switch (action) {
      case 'list-chats':
        return await handleListChats(client)
      case 'get-messages':
        return await handleGetMessages(client, body)
      default:
        return json(
          { error: 'إجراء غير معروف. الإجراءات المدعومة: list-chats, get-messages' },
          400,
        )
    }
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    console.error('[MESSAGES] Failed:', detail)

    if (/AUTH_KEY|SESSION_REVOKED|USER_DEACTIVATED/i.test(detail)) {
      await supabase
        .from('telegram_sessions')
        .update({
          status: 'expired',
          status_message: 'انتهت صلاحية جلسة Telegram. أعد ربط حسابك.',
          status_changed_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)
      return json({ error: 'انتهت صلاحية جلسة Telegram. أعد ربط حسابك.' }, 401)
    }

    return json({ error: `تعذر قراءة المحادثات (${detail})` }, 500)
  } finally {
    try {
      await client?.destroy()
    } catch {
      // Closing a socket Telegram already dropped is not worth surfacing.
    }
  }
})
