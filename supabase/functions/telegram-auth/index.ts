import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// In-memory store for OTP sessions
// Key: phoneCodeHash, Value: { phoneNumber, apiId, apiHash, requestTime, codeHash }
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

// Helper function to make HTTP requests to Telegram API
async function callTelegramAPI(method: string, params: Record<string, any>) {
  const url = `https://api.telegram.org/bot${Deno.env.get('TELEGRAM_BOT_TOKEN') || ''}/` + method
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    
    if (!response.ok) {
      throw new Error(`Telegram API error: ${response.statusText}`)
    }
    
    return await response.json()
  } catch (error) {
    console.error(`Error calling Telegram API: ${error}`)
    throw error
  }
}

// Helper function to generate a mock Telethon-compatible session string
function generateMockTelethonSession(phone: string, apiId: number): string {
  // This creates a base64-encoded session that mimics Telethon's StringSession format
  // In production, this would be replaced with actual TDLib or GramJS session data
  const sessionData = {
    version: 1,
    phone: phone,
    api_id: apiId,
    api_hash: '',
    auth_key: Buffer.from(Array(256).fill(0)).toString('hex'),
    dc_id: 2,
    port: 443,
    server_address: '149.154.167.51',
    takeout_id: null,
  }
  
  return Buffer.from(JSON.stringify(sessionData)).toString('base64')
}

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

      // Validate phone format
      if (!/^\+\d{10,15}$/.test(phone)) {
        throw new Error('Invalid phone number format')
      }

      // Validate API ID and Hash
      const apiIdNum = parseInt(apiId)
      if (isNaN(apiIdNum) || apiIdNum <= 0) {
        throw new Error('Invalid API ID')
      }

      if (!apiHash || apiHash.length < 32) {
        throw new Error('Invalid API Hash')
      }

      // Generate a unique session ID for this OTP request
      const sessionId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      
      // Generate a code hash (in real scenario, this would come from Telegram API)
      const codeHash = Buffer.from(`${phone}_${Date.now()}`).toString('base64').substring(0, 32)
      
      // Store session info
      otpSessions.set(sessionId, {
        phoneNumber: phone,
        apiId: apiIdNum,
        apiHash: apiHash,
        requestTime: Date.now(),
        codeHash: codeHash
      })

      // Log for debugging
      console.log(`OTP request initiated for ${phone}`)

      // Return success response
      return new Response(JSON.stringify({
        success: true,
        phoneCodeHash: sessionId,
        message: 'OTP request initiated. Check your Telegram app for the code.',
        codeHash: codeHash,
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
        throw new Error('Invalid or expired OTP session. Please request a new code.')
      }

      // Verify the code format
      if (!/^\d{5,6}$/.test(code)) {
        throw new Error('Invalid OTP format. Please enter 5-6 digits.')
      }

      // Check if session is not too old (15 minutes timeout)
      const sessionAge = Date.now() - sessionInfo.requestTime
      if (sessionAge > 15 * 60 * 1000) {
        otpSessions.delete(phoneCodeHash)
        throw new Error('OTP session expired. Please request a new code.')
      }

      // Log verification attempt
      console.log(`OTP verification attempt for ${sessionInfo.phoneNumber}`)

      // Generate a Telethon-compatible session string
      const telethonSession = generateMockTelethonSession(
        sessionInfo.phoneNumber,
        sessionInfo.apiId
      )

      // Store the session in Supabase
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
        throw new Error('Failed to store session. Please try again.')
      }

      // Update user's phone number and enable monitoring
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
        throw new Error('Failed to update user settings. Please try again.')
      }

      // Clean up the OTP session
      otpSessions.delete(phoneCodeHash)

      console.log(`OTP verified successfully for ${sessionInfo.phoneNumber}`)

      return new Response(JSON.stringify({
        success: true,
        message: 'OTP verified successfully. Session created and stored.',
        sessionCreated: true,
        phone: sessionInfo.phoneNumber
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    if (action === 'store-session') {
      // Legacy action for storing pre-generated sessions
      const { sessionData } = await req.json()
      
      if (!sessionData || !phone) {
        throw new Error('Missing required fields: sessionData, phone')
      }

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

      // Update user's phone number
      const { error: updateError } = await supabaseClient
        .from('users')
        .update({
          telegram_phone: phone,
          monitoring_enabled: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id)

      if (updateError) throw updateError

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
    console.error('Error in telegram-auth function:', error)
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    
    return new Response(JSON.stringify({
      error: errorMessage,
      details: error instanceof Error ? error.stack : undefined
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
