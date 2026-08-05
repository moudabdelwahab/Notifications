/**
 * telegram-auth — real Telegram (MTProto) login for the onboarding flow.
 *
 * Actions:
 *   send-otp        { phone, apiId, apiHash }        -> { sessionId, phoneCodeHash, codeType, codeLength, timeout }
 *   verify-otp      { sessionId, code }              -> { success } | { requiresPassword, passwordHint }
 *   verify-password { sessionId, password }          -> { success }
 *
 * The MTProto auth key created by `send-otp` MUST be reused by `verify-otp`, because the
 * phone_code_hash Telegram returns is bound to it. Edge Function invocations do not share
 * memory, so the intermediate mtcute session is persisted in `otp_sessions.session_string`.
 *
 * On success the session is converted to a Telethon v1 string session and stored in
 * Supabase Vault, which is the format `server/workers/telegram_worker.py` (Telethon) reads.
 */
import { TelegramClient } from 'jsr:@mtcute/web@0.31.0'
import { MemoryStorage } from 'jsr:@mtcute/core@0.31.0'
import { readStringSession } from 'jsr:@mtcute/core@0.31.0/utils.js'
import { convertToTelethonSession } from 'jsr:@mtcute/convert@0.31.0'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** OTP sessions older than this are rejected and cleaned up. */
const SESSION_TTL_MS = 15 * 60 * 1000
/** Minimum gap between two send-otp calls for the same user. */
const RESEND_COOLDOWN_MS = 60 * 1000

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

/**
 * Maps Telegram's RPC error names to Arabic messages for the UI.
 * Unknown errors fall through to their raw name so nothing is silently swallowed.
 */
const TELEGRAM_ERRORS: Record<string, string> = {
  PHONE_NUMBER_INVALID: 'رقم الهاتف غير صحيح. تأكد من كتابته بالصيغة الدولية.',
  PHONE_NUMBER_BANNED: 'هذا الرقم محظور من Telegram.',
  PHONE_NUMBER_FLOOD: 'تم طلب عدد كبير من الرموز لهذا الرقم. حاول بعد فترة.',
  PHONE_CODE_INVALID: 'رمز التحقق غير صحيح.',
  PHONE_CODE_EXPIRED: 'انتهت صلاحية رمز التحقق. اطلب رمزاً جديداً.',
  PHONE_CODE_EMPTY: 'لم يتم إدخال رمز التحقق.',
  PHONE_PASSWORD_FLOOD: 'محاولات كثيرة لكلمة المرور. حاول لاحقاً.',
  PASSWORD_HASH_INVALID: 'كلمة المرور غير صحيحة.',
  API_ID_INVALID: 'API ID أو API Hash غير صحيح. راجع بياناتك من my.telegram.org.',
  API_ID_PUBLISHED_FLOOD: 'بيانات API مستخدمة بكثرة. أنشئ تطبيقاً جديداً على my.telegram.org.',
  AUTH_RESTART: 'تحتاج إعادة بدء عملية التحقق. اطلب رمزاً جديداً.',
  SESSION_PASSWORD_NEEDED: 'الحساب محمي بالتحقق بخطوتين.',
  PHONE_NUMBER_UNOCCUPIED: 'لا يوجد حساب Telegram مرتبط بهذا الرقم.',
  SIGN_IN_FAILED: 'فشل تسجيل الدخول إلى Telegram. حاول مرة أخرى.',
}

/** Extracts Telegram's error name (e.g. PHONE_CODE_INVALID) from an mtcute RpcError. */
function telegramErrorName(err: unknown): string | null {
  const raw =
    (err as { text?: string })?.text ??
    (err as { message?: string })?.message ??
    ''
  const match = String(raw).match(/[A-Z][A-Z0-9_]{3,}/)
  return match ? match[0] : null
}

function describeError(err: unknown, fallback: string): { name: string | null; message: string } {
  const name = telegramErrorName(err)
  if (name && TELEGRAM_ERRORS[name]) return { name, message: TELEGRAM_ERRORS[name] }
  if (name?.startsWith('FLOOD_WAIT')) {
    const seconds = String((err as { message?: string })?.message ?? '').match(/\d+/)?.[0]
    return {
      name,
      message: seconds
        ? `Telegram يطلب الانتظار ${seconds} ثانية قبل المحاولة مرة أخرى.`
        : 'Telegram يطلب الانتظار قبل المحاولة مرة أخرى.',
    }
  }
  const detail = err instanceof Error ? err.message : String(err)
  return { name, message: `${fallback} (${detail})` }
}

function newClient(apiId: number, apiHash: string): TelegramClient {
  return new TelegramClient({
    apiId,
    apiHash,
    storage: new MemoryStorage(),
    // The edge runtime has no persistent filesystem and updates are handled by the
    // Python worker, so there is nothing to catch up on here.
    disableUpdates: true,
  })
}

async function shutdown(client: TelegramClient | null): Promise<void> {
  if (!client) return
  try {
    await client.destroy()
  } catch {
    // Closing a socket that Telegram already dropped is not an error worth surfacing.
  }
}

/**
 * Turns a signed-in mtcute client into a Telethon-compatible string session and
 * records it as the user's active Telegram session.
 */
async function persistSession(
  supabase: SupabaseClient,
  client: TelegramClient,
  otpSession: { id: string; user_id: string; phone_number: string; api_id: number; api_hash: string },
): Promise<Response> {
  const mtcuteSession = await client.exportSession()
  const telethonSession = convertToTelethonSession(readStringSession(mtcuteSession))

  // The session string and api_hash grant full control of the Telegram account,
  // so they are written straight into Vault. This RPC is the only writer; nothing
  // stores them as plaintext columns.
  const { error: storeError } = await supabase.rpc('set_telegram_session', {
    p_user_id: otpSession.user_id,
    p_session: telethonSession,
    p_phone: otpSession.phone_number,
    p_api_id: String(otpSession.api_id),
    p_api_hash: otpSession.api_hash,
  })
  if (storeError) {
    console.error('[PERSIST] Failed to store telegram session:', storeError)
    return json({ error: `تعذر حفظ جلسة Telegram: ${storeError.message}` }, 500)
  }

  // The OTP session has served its purpose; it holds an auth key so it must not linger.
  await supabase.from('otp_sessions').delete().eq('id', otpSession.id)

  console.log('[PERSIST] Session stored for user', otpSession.user_id)
  return json({ success: true, phone: otpSession.phone_number })
}

/** Loads the pending OTP session for this user and rejects stale or foreign rows. */
async function loadOtpSession(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  expectedState: 'pending_otp' | 'pending_password',
) {
  const { data, error } = await supabase
    .from('otp_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('[SESSION] Lookup failed:', error)
    return { error: json({ error: `تعذر قراءة جلسة التحقق: ${error.message}` }, 500) }
  }
  if (!data) {
    return { error: json({ error: 'جلسة التحقق غير موجودة. اطلب رمزاً جديداً.' }, 400) }
  }
  if (Date.now() - new Date(data.created_at).getTime() > SESSION_TTL_MS) {
    await supabase.from('otp_sessions').delete().eq('id', data.id)
    return { error: json({ error: 'انتهت صلاحية جلسة التحقق. اطلب رمزاً جديداً.' }, 400) }
  }
  if (data.auth_state !== expectedState) {
    return {
      error: json({ error: 'حالة التحقق غير متوقعة. اطلب رمزاً جديداً.', authState: data.auth_state }, 400),
    }
  }
  if (!data.session_string) {
    return { error: json({ error: 'جلسة التحقق غير مكتملة. اطلب رمزاً جديداً.' }, 400) }
  }
  return { data }
}

async function handleSendOtp(supabase: SupabaseClient, userId: string, body: Record<string, unknown>) {
  const phone = String(body.phone ?? '').trim()
  const apiIdRaw = String(body.apiId ?? '').trim()
  const apiHash = String(body.apiHash ?? '').trim()

  if (!phone || !apiIdRaw || !apiHash) {
    return json({ error: 'الحقول المطلوبة ناقصة: phone و apiId و apiHash' }, 400)
  }
  if (!/^\+\d{10,15}$/.test(phone)) {
    return json({ error: 'صيغة رقم الهاتف غير صحيحة. استخدم الصيغة الدولية مثل ‎+966500000000' }, 400)
  }
  const apiId = Number.parseInt(apiIdRaw, 10)
  if (!Number.isInteger(apiId) || apiId <= 0) {
    return json({ error: 'API ID يجب أن يكون رقماً صحيحاً موجباً' }, 400)
  }
  if (apiHash.length < 32) {
    return json({ error: 'API Hash يجب أن يكون 32 حرفاً على الأقل' }, 400)
  }

  // Throttle resends so a stuck UI cannot hammer Telegram into a FLOOD_WAIT.
  const { data: recent } = await supabase
    .from('otp_sessions')
    .select('created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
  const lastSentAt = recent?.[0]?.created_at
  if (lastSentAt) {
    const elapsed = Date.now() - new Date(lastSentAt).getTime()
    if (elapsed < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000)
      return json({ error: `انتظر ${wait} ثانية قبل طلب رمز جديد.`, retryAfter: wait }, 429)
    }
  }

  let client: TelegramClient | null = null
  try {
    client = newClient(apiId, apiHash)
    await client.connect()

    console.log('[SEND-OTP] Requesting code for', phone)
    const sent = await client.sendCode({ phone })

    // sendCode resolves to a User when the account was already authorised, in which
    // case there is no code to verify and no phoneCodeHash to hand back.
    if (typeof (sent as { phoneCodeHash?: unknown }).phoneCodeHash !== 'string') {
      return json({ error: 'تعذر إرسال رمز التحقق. ابدأ العملية من جديد.' }, 400)
    }

    const mtcuteSession = await client.exportSession()

    // Only one pending attempt per user; the previous auth key is useless now.
    await supabase.from('otp_sessions').delete().eq('user_id', userId)

    const { data: inserted, error: insertError } = await supabase
      .from('otp_sessions')
      .insert({
        user_id: userId,
        phone_number: phone,
        api_id: apiId,
        api_hash: apiHash,
        phone_code_hash: sent.phoneCodeHash,
        session_string: mtcuteSession,
        auth_state: 'pending_otp',
      })
      .select('id')
      .single()

    if (insertError || !inserted) {
      console.error('[SEND-OTP] Insert failed:', insertError)
      return json({ error: `تعذر حفظ جلسة التحقق: ${insertError?.message ?? 'unknown'}` }, 500)
    }

    console.log('[SEND-OTP] Code sent via', sent.type, '- session', inserted.id)
    return json({
      success: true,
      sessionId: inserted.id,
      phoneCodeHash: sent.phoneCodeHash,
      // `type` is a delivery-channel string ('app' | 'sms' | ...); the digit count is
      // a separate property, so the UI can size the code input correctly.
      codeType: sent.type,
      codeLength: sent.length,
      timeout: sent.timeout,
    })
  } catch (err) {
    const { name, message } = describeError(err, 'تعذر إرسال رمز التحقق')
    console.error('[SEND-OTP] Failed:', name, err)
    return json({ error: message, telegramError: name }, 400)
  } finally {
    await shutdown(client)
  }
}

async function handleVerifyOtp(supabase: SupabaseClient, userId: string, body: Record<string, unknown>) {
  const sessionId = String(body.sessionId ?? '').trim()
  const code = String(body.code ?? '').trim()

  if (!sessionId || !code) {
    return json({ error: 'الحقول المطلوبة ناقصة: sessionId و code' }, 400)
  }
  if (!/^\d{4,7}$/.test(code)) {
    return json({ error: 'صيغة الرمز غير صحيحة. أدخل الأرقام التي وصلتك فقط.' }, 400)
  }

  const loaded = await loadOtpSession(supabase, userId, sessionId, 'pending_otp')
  if (loaded.error) return loaded.error
  const otpSession = loaded.data

  let client: TelegramClient | null = null
  try {
    client = newClient(otpSession.api_id, otpSession.api_hash)
    await client.importSession(otpSession.session_string)
    await client.connect()

    try {
      await client.signIn({
        phone: otpSession.phone_number,
        phoneCodeHash: otpSession.phone_code_hash,
        phoneCode: code,
      })
    } catch (err) {
      if (telegramErrorName(err) !== 'SESSION_PASSWORD_NEEDED') throw err

      // Account has Two-Step Verification: keep the same auth key for the password step.
      console.log('[VERIFY-OTP] 2FA required for session', sessionId)
      let hint: string | null = null
      try {
        hint = await client.getPasswordHint()
      } catch {
        // A missing hint is not fatal — the UI just shows a generic prompt.
      }

      const pendingSession = await client.exportSession()
      const { error: updateError } = await supabase
        .from('otp_sessions')
        .update({
          auth_state: 'pending_password',
          session_string: pendingSession,
          password_hint: hint,
        })
        .eq('id', otpSession.id)

      if (updateError) {
        console.error('[VERIFY-OTP] Failed to save 2FA state:', updateError)
        return json({ error: `تعذر حفظ حالة التحقق بخطوتين: ${updateError.message}` }, 500)
      }

      return json({
        success: false,
        requiresPassword: true,
        sessionId: otpSession.id,
        passwordHint: hint,
      })
    }

    console.log('[VERIFY-OTP] Signed in, persisting session', sessionId)
    return await persistSession(supabase, client, otpSession)
  } catch (err) {
    const { name, message } = describeError(err, 'فشل التحقق من الرمز')
    console.error('[VERIFY-OTP] Failed:', name, err)
    // An expired or restarted code cannot be retried against the same auth key.
    if (name === 'PHONE_CODE_EXPIRED' || name === 'AUTH_RESTART') {
      await supabase.from('otp_sessions').delete().eq('id', otpSession.id)
    }
    return json({ error: message, telegramError: name }, 400)
  } finally {
    await shutdown(client)
  }
}

async function handleVerifyPassword(supabase: SupabaseClient, userId: string, body: Record<string, unknown>) {
  const sessionId = String(body.sessionId ?? '').trim()
  const password = String(body.password ?? '')

  if (!sessionId || !password) {
    return json({ error: 'الحقول المطلوبة ناقصة: sessionId و password' }, 400)
  }

  const loaded = await loadOtpSession(supabase, userId, sessionId, 'pending_password')
  if (loaded.error) return loaded.error
  const otpSession = loaded.data

  let client: TelegramClient | null = null
  try {
    client = newClient(otpSession.api_id, otpSession.api_hash)
    await client.importSession(otpSession.session_string)
    await client.connect()

    await client.checkPassword(password)

    console.log('[VERIFY-PASSWORD] 2FA accepted, persisting session', sessionId)
    return await persistSession(supabase, client, otpSession)
  } catch (err) {
    const { name, message } = describeError(err, 'فشل التحقق من كلمة المرور')
    console.error('[VERIFY-PASSWORD] Failed:', name, err)
    return json({ error: message, telegramError: name }, 400)
  } finally {
    await shutdown(client)
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[MAIN] Missing Supabase configuration')
    return json({ error: 'إعدادات Supabase غير مكتملة على الخادم' }, 500)
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return json({ error: 'مطلوب تسجيل الدخول' }, 401)
  }

  const { data: { user }, error: userError } = await supabase.auth.getUser(
    authHeader.replace(/^Bearer\s+/i, ''),
  )
  if (userError || !user) {
    console.error('[MAIN] Token verification failed:', userError)
    return json({ error: 'جلسة الدخول غير صالحة. سجّل الدخول مرة أخرى.' }, 401)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'صيغة الطلب غير صحيحة' }, 400)
  }

  // The FK on otp_sessions requires a public.users row; create it if the signup
  // trigger never ran for this account.
  const { error: profileError } = await supabase
    .from('users')
    .upsert({ id: user.id, email: user.email }, { onConflict: 'id', ignoreDuplicates: true })
  if (profileError) {
    console.error('[MAIN] Failed to ensure user profile:', profileError)
  }

  const action = String(body.action ?? '')
  console.log('[MAIN] action:', action, 'user:', user.id)

  switch (action) {
    case 'send-otp':
      return await handleSendOtp(supabase, user.id, body)
    case 'verify-otp':
      return await handleVerifyOtp(supabase, user.id, body)
    case 'verify-password':
      return await handleVerifyPassword(supabase, user.id, body)
    default:
      return json(
        { error: 'إجراء غير معروف. الإجراءات المدعومة: send-otp, verify-otp, verify-password', receivedAction: action },
        400,
      )
  }
})
