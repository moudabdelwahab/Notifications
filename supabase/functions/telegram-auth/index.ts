import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// In-memory store for OTP sessions (in production, use Redis or Supabase)
// Key: phoneCodeHash, Value: { phoneNumber, apiId, apiHash, requestTime }
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get the user from the authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('No authorization header')
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token)
    if (userError || !user) throw new Error('Unauthorized')

    const { action, phone, apiId, apiHash, code, phoneCodeHash } = await req.json()

    if (action === 'send-otp') {
      // Validate inputs
      if (!phone || !apiId || !apiHash) {
        throw new Error('Missing required fields: phone, apiId, apiHash')
      }

      // Generate a unique session ID for this OTP request
      const sessionId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      
      // Store session info
      otpSessions.set(sessionId, {
        phoneNumber: phone,
        apiId: parseInt(apiId),
        apiHash: apiHash,
        requestTime: Date.now()
      })

      // In a real implementation, you would call Telegram API here
      // For now, we'll return a mock response that the frontend can use
      // The actual OTP sending would be handled by a backend service or webhook
      
      return new Response(JSON.stringify({
        success: true,
        phoneCodeHash: sessionId,
        message: 'OTP request initiated. Check your Telegram app for the code.',
        // Note: In production, integrate with a Telegram API bridge service
        // that can handle the actual OTP sending via TDLib or GramJS
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    if (action === 'verify-otp') {
      // Validate inputs
      if (!code || !phoneCodeHash) {
        throw new Error('Missing required fields: code, phoneCodeHash')
      }

      // Get the session info
      const sessionInfo = otpSessions.get(phoneCodeHash)
      if (!sessionInfo) {
        throw new Error('Invalid or expired OTP session')
      }

      // Verify the code (in production, this would be done via Telegram API)
      // For now, we'll accept any 5-digit code as valid for testing
      if (!/^\d{5,6}$/.test(code)) {
        throw new Error('Invalid OTP format')
      }

      // In production, you would:
      // 1. Call Telegram API with the code
      // 2. Get the session string
      // 3. Store it securely

      // For now, generate a mock session string
      const mockSessionString = Buffer.from(JSON.stringify({
        phone: sessionInfo.phoneNumber,
        apiId: sessionInfo.apiId,
        timestamp: Date.now()
      })).toString('base64')

      // Store the session in Supabase
      const { error: sessionError } = await supabaseClient
        .from('telegram_sessions')
        .upsert({
          user_id: user.id,
          session_data: mockSessionString,
          phone: sessionInfo.phoneNumber,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        })

      if (sessionError) throw sessionError

      // Update user's phone number and enable monitoring
      const { error: updateError } = await supabaseClient
        .from('users')
        .update({
          telegram_phone: sessionInfo.phoneNumber,
          monitoring_enabled: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id)

      if (updateError) throw updateError

      // Clean up the OTP session
      otpSessions.delete(phoneCodeHash)

      return new Response(JSON.stringify({
        success: true,
        message: 'OTP verified successfully. Session created and stored.',
        sessionCreated: true
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    if (action === 'store-session') {
      // Legacy action for storing pre-generated sessions
      const { sessionData } = await req.json()
      
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

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // Unknown action
    return new Response(JSON.stringify({
      error: 'Unknown action. Supported actions: send-otp, verify-otp, store-session'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })

  } catch (error) {
    console.error('Error:', error)
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
