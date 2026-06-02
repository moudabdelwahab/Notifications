import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Import GramJS
import { TelegramClient } from "https://esm.sh/telegram@3.14.0"
import { StringSession } from "https://esm.sh/telegram@3.14.0"
import { NewMessage } from "https://esm.sh/telegram@3.14.0/events"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Store for active client connections (temporary, will be replaced with proper session management)
const activeClients = new Map<string, { client: TelegramClient; sessionId: string }>()

// Helper function to generate a random string
function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// Helper function to create TelegramClient
async function createTelegramClient(
  apiId: number,
  apiHash: string,
  sessionString: string = ''
): Promise<TelegramClient> {
  const session = sessionString ? new StringSession(sessionString) : new StringSession('')
  
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  })
  
  return client
}

// Send OTP action
async function handleSendOtp(
  req: any,
  supabaseClient: any,
  user: any,
  body: any
): Promise<Response> {
  const { phone, apiId, apiHash } = body

  // Validate inputs
  if (!phone || !apiId || !apiHash) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: phone, apiId, apiHash' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }

  // Validate phone format
  if (!/^\+\d{10,15}$/.test(phone)) {
    return new Response(
      JSON.stringify({ error: 'Invalid phone number format. Use international format like +966500000000' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }

  // Validate API ID
  const apiIdNum = parseInt(apiId)
  if (isNaN(apiIdNum) || apiIdNum <= 0) {
    return new Response(
      JSON.stringify({ error: 'Invalid API ID. Must be a positive number' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }

  // Validate API Hash
  if (!apiHash || apiHash.length < 32) {
    return new Response(
      JSON.stringify({ error: 'Invalid API Hash. Must be at least 32 characters' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }

  try {
    // Create Telegram client
    const client = await createTelegramClient(apiIdNum, apiHash)

    // Connect to Telegram
    await client.connect()

    // Request OTP
    const result = await client.sendCode({
      apiId: apiIdNum,
      apiHash: apiHash,
      phoneNumber: phone,
    })

    // Generate session ID for tracking
    const sessionId = `${Date.now()}_${generateRandomString(12)}`
    const phoneCodeHash = result.phoneCodeHash

    // Store OTP session in Supabase
    const { error: insertError } = await supabaseClient
      .from('otp_sessions')
      .insert({
        user_id: user.id,
        phone_number: phone,
        api_id: apiIdNum,
        api_hash: apiHash,
        phone_code_hash: phoneCodeHash,
      })

    if (insertError) {
      console.error('Error storing OTP session:', insertError)
      await client.disconnect()
      return new Response(
        JSON.stringify({ error: `Failed to store OTP session: ${insertError.message}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    // Store client for later verification
    activeClients.set(sessionId, { client, sessionId })

    // Cleanup after 15 minutes
    setTimeout(() => {
      const stored = activeClients.get(sessionId)
      if (stored) {
        stored.client.disconnect().catch(console.error)
        activeClients.delete(sessionId)
      }
    }, 15 * 60 * 1000)

    console.log(`OTP request sent successfully for ${phone}`)

    return new Response(
      JSON.stringify({
        success: true,
        phoneCodeHash: phoneCodeHash,
        sessionId: sessionId,
        message: 'OTP request initiated. Check your Telegram app for the code.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    console.error('Error in send-otp:', error)
    return new Response(
      JSON.stringify({ error: `Failed to send OTP: ${error instanceof Error ? error.message : 'Unknown error'}` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
}

// Verify OTP action
async function handleVerifyOtp(
  req: any,
  supabaseClient: any,
  user: any,
  body: any
): Promise<Response> {
  const { code, phoneCodeHash, sessionId } = body

  // Validate inputs
  if (!code || !phoneCodeHash) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: code, phoneCodeHash' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }

  // Verify code format
  if (!/^\d{5,6}$/.test(code)) {
    return new Response(
      JSON.stringify({ error: 'Invalid OTP format. Please enter 5-6 digits.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }

  try {
    // Get OTP session from Supabase
    const { data: otpSession, error: fetchError } = await supabaseClient
      .from('otp_sessions')
      .select('*')
      .eq('phone_code_hash', phoneCodeHash)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !otpSession) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired OTP session. Please request a new code.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Check session age (15 minutes)
    const sessionAge = Date.now() - new Date(otpSession.created_at).getTime()
    if (sessionAge > 15 * 60 * 1000) {
      await supabaseClient
        .from('otp_sessions')
        .delete()
        .eq('id', otpSession.id)
      
      return new Response(
        JSON.stringify({ error: 'OTP session expired. Please request a new code.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Get stored client
    const storedClient = sessionId ? activeClients.get(sessionId) : null
    let client: TelegramClient | null = null

    if (storedClient) {
      client = storedClient.client
    } else {
      // Create new client if not stored
      client = await createTelegramClient(
        otpSession.api_id,
        otpSession.api_hash
      )
      await client.connect()
    }

    // Sign in with OTP code
    const result = await client.signInWithPhoneNumber(
      otpSession.phone_number,
      {
        phoneCodeHash: phoneCodeHash,
        phoneCode: code,
      }
    )

    // Get session string
    const sessionString = client.session.save()

    // Store session in Supabase
    const { error: sessionError } = await supabaseClient
      .from('telegram_sessions')
      .upsert({
        user_id: user.id,
        session_data: sessionString,
        phone: otpSession.phone_number,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      })

    if (sessionError) {
      console.error('Session storage error:', sessionError)
      await client.disconnect()
      return new Response(
        JSON.stringify({ error: `Failed to store session: ${sessionError.message}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    // Update user settings
    const { error: updateError } = await supabaseClient
      .from('users')
      .update({
        telegram_phone: otpSession.phone_number,
        telegram_api_id: otpSession.api_id.toString(),
        telegram_api_hash: otpSession.api_hash,
        monitoring_enabled: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id)

    if (updateError) {
      console.error('User update error:', updateError)
      await client.disconnect()
      return new Response(
        JSON.stringify({ error: `Failed to update user settings: ${updateError.message}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    // Clean up OTP session
    await supabaseClient
      .from('otp_sessions')
      .delete()
      .eq('id', otpSession.id)

    // Clean up client
    if (sessionId) {
      activeClients.delete(sessionId)
    }
    await client.disconnect()

    console.log(`OTP verified successfully for ${otpSession.phone_number}`)

    return new Response(
      JSON.stringify({
        success: true,
        message: 'OTP verified successfully. Session created and stored.',
        sessionCreated: true,
        phone: otpSession.phone_number
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    console.error('Error in verify-otp:', error)
    return new Response(
      JSON.stringify({ error: `Verification failed: ${error instanceof Error ? error.message : 'Unknown error'}` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
}

// Store session action
async function handleStoreSession(
  req: any,
  supabaseClient: any,
  user: any,
  body: any
): Promise<Response> {
  const { sessionData, phone } = body

  if (!sessionData || !phone) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: sessionData, phone' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }

  try {
    const { error: sessionError } = await supabaseClient
      .from('telegram_sessions')
      .upsert({
        user_id: user.id,
        session_data: sessionData,
        phone: phone,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      })

    if (sessionError) throw sessionError

    const { error: updateError } = await supabaseClient
      .from('users')
      .update({
        telegram_phone: phone,
        monitoring_enabled: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id)

    if (updateError) throw updateError

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    console.error('Error in store-session:', error)
    return new Response(
      JSON.stringify({ error: `Failed to store session: ${error instanceof Error ? error.message : 'Unknown error'}` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase configuration')
    }

    const supabaseClient = createClient(supabaseUrl, supabaseKey)

    // Get authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No authorization header' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    // Verify user token
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token)
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    // Parse request body
    let body: any
    try {
      const bodyText = await req.text()
      body = JSON.parse(bodyText)
    } catch (error) {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON in request body' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const { action } = body

    // Route to appropriate handler
    if (action === 'send-otp') {
      return await handleSendOtp(req, supabaseClient, user, body)
    } else if (action === 'verify-otp') {
      return await handleVerifyOtp(req, supabaseClient, user, body)
    } else if (action === 'store-session') {
      return await handleStoreSession(req, supabaseClient, user, body)
    } else {
      return new Response(
        JSON.stringify({
          error: 'Unknown action. Supported actions: send-otp, verify-otp, store-session'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

  } catch (error) {
    console.error('Unexpected error:', error)
    return new Response(
      JSON.stringify({
        error: `Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
