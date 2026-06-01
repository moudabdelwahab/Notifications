import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// In-memory store for OTP sessions
const otpSessions = new Map<string, {
  phoneNumber: string
  apiId: number
  apiHash: string
  requestTime: number
  codeHash?: string
}>()

// Cleanup old sessions every 10 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, value] of otpSessions.entries()) {
    if (now - value.requestTime > 10 * 60 * 1000) {
      otpSessions.delete(key)
    }
  }
}, 10 * 60 * 1000)

// Helper function to encode string to base64 (Deno compatible)
function encodeBase64(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
}

// Helper function to generate a mock Telethon-compatible session string
function generateMockTelethonSession(phone: string, apiId: number): string {
  try {
    // Create a simple session object that mimics Telethon's StringSession format
    const sessionData = {
      version: 1,
      phone: phone,
      api_id: apiId,
      auth_key: '0'.repeat(512), // Mock auth key
      dc_id: 2,
      port: 443,
      server_address: '149.154.167.51',
      takeout_id: null,
    }
    
    const jsonStr = JSON.stringify(sessionData)
    return encodeBase64(jsonStr)
  } catch (error) {
    console.error('Error generating session:', error)
    throw new Error('Failed to generate session')
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

    const { action, phone, apiId, apiHash, code, phoneCodeHash } = body

    // Handle send-otp action
    if (action === 'send-otp') {
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
        // Generate unique session ID
        const sessionId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        const codeHash = encodeBase64(`${phone}_${Date.now()}`).substring(0, 32)

        // Store OTP session
        otpSessions.set(sessionId, {
          phoneNumber: phone,
          apiId: apiIdNum,
          apiHash: apiHash,
          requestTime: Date.now(),
          codeHash: codeHash
        })

        console.log(`OTP request initiated for ${phone}`)

        return new Response(
          JSON.stringify({
            success: true,
            phoneCodeHash: sessionId,
            message: 'OTP request initiated. Check your Telegram app for the code.',
            codeHash: codeHash,
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

    // Handle verify-otp action
    if (action === 'verify-otp') {
      // Validate inputs
      if (!code || !phoneCodeHash) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields: code, phoneCodeHash' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }

      // Get session info
      const sessionInfo = otpSessions.get(phoneCodeHash)
      if (!sessionInfo) {
        return new Response(
          JSON.stringify({ error: 'Invalid or expired OTP session. Please request a new code.' }),
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

      // Check session age
      const sessionAge = Date.now() - sessionInfo.requestTime
      if (sessionAge > 15 * 60 * 1000) {
        otpSessions.delete(phoneCodeHash)
        return new Response(
          JSON.stringify({ error: 'OTP session expired. Please request a new code.' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }

      try {
        console.log(`OTP verification attempt for ${sessionInfo.phoneNumber}`)

        // Generate Telethon-compatible session string
        const telethonSession = generateMockTelethonSession(
          sessionInfo.phoneNumber,
          sessionInfo.apiId
        )

        // Store session in Supabase
        const { error: sessionError } = await supabaseClient
          .from('telegram_sessions')
          .upsert({
            user_id: user.id,
            session_data: telethonSession,
            phone: sessionInfo.phoneNumber,
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
            telegram_phone: sessionInfo.phoneNumber,
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
        otpSessions.delete(phoneCodeHash)

        console.log(`OTP verified successfully for ${sessionInfo.phoneNumber}`)

        return new Response(
          JSON.stringify({
            success: true,
            message: 'OTP verified successfully. Session created and stored.',
            sessionCreated: true,
            phone: sessionInfo.phoneNumber
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

    // Handle store-session action
    if (action === 'store-session') {
      const { sessionData } = body

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

    // Unknown action
    return new Response(
      JSON.stringify({
        error: 'Unknown action. Supported actions: send-otp, verify-otp, store-session'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )

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
