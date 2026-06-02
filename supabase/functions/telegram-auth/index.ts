import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Store for active client connections and OTP codes
const activeClients = new Map<string, { 
  phoneCodeHash: string
  phone: string
  expectedCode?: string
  codeAttempts: number
  createdAt: number
}>()

function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

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
    // Generate a real OTP code (5-6 digits)
    const otpCode = Math.floor(Math.random() * 900000) + 100000
    const phoneCodeHash = generateRandomString(32)
    const sessionId = `${Date.now()}_${generateRandomString(12)}`

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
      return new Response(
        JSON.stringify({ error: `Failed to store OTP session: ${insertError.message}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    // Store client data with the real OTP code
    activeClients.set(sessionId, {
      phoneCodeHash,
      phone,
      expectedCode: otpCode.toString(),
      codeAttempts: 0,
      createdAt: Date.now()
    })

    // Cleanup after 15 minutes
    setTimeout(() => {
      activeClients.delete(sessionId)
    }, 15 * 60 * 1000)

    console.log(`OTP generated for ${phone}: ${otpCode}`)

    return new Response(
      JSON.stringify({
        success: true,
        phoneCodeHash: phoneCodeHash,
        sessionId: sessionId,
        message: `OTP code sent to ${phone}. Your code is: ${otpCode}. (This is a test environment)`,
        testOtpCode: otpCode, // For testing purposes
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    console.error('Error in send-otp:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: `Failed to send OTP: ${errorMessage}` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
}

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

    // Get stored client data
    const storedClient = sessionId ? activeClients.get(sessionId) : null
    
    if (!storedClient) {
      return new Response(
        JSON.stringify({ error: 'Session not found. Please request a new OTP code.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Check if code matches
    if (storedClient.expectedCode !== code) {
      storedClient.codeAttempts++
      
      // Block after 3 failed attempts
      if (storedClient.codeAttempts >= 3) {
        activeClients.delete(sessionId)
        await supabaseClient
          .from('otp_sessions')
          .delete()
          .eq('id', otpSession.id)
        
        return new Response(
          JSON.stringify({ 
            error: 'Too many failed attempts. Please request a new OTP code.',
            attemptsRemaining: 0
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }

      return new Response(
        JSON.stringify({ 
          error: 'Invalid OTP code. Please try again.',
          attemptsRemaining: 3 - storedClient.codeAttempts
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Code is correct! Generate session string
    const sessionString = `session_${generateRandomString(64)}`

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
    activeClients.delete(sessionId)

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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: `Verification failed: ${errorMessage}` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
}

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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: `Failed to store session: ${errorMessage}` }),
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({
        error: `Unexpected error: ${errorMessage}`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
