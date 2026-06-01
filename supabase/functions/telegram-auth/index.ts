import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    // Note: Since Telethon is Python-based and we are in a Deno environment,
    // we would typically use a Python backend or a library like 'gramjs' for Deno/Node.
    // However, for this implementation, we will provide a structure that the frontend
    // can use, and the actual Telegram interaction will happen via a helper service
    // or by adapting the GitHub Action worker to also handle the initial session creation
    // if needed. For now, we'll implement the logic to store the session data.

    if (action === 'store-session') {
      const { sessionData } = await req.json()
      
      const { error: sessionError } = await supabaseClient
        .from('telegram_sessions')
        .upsert({
          user_id: user.id,
          session_data: sessionData,
          phone: phone,
          updated_at: new Date().toISOString()
        })

      if (sessionError) throw sessionError

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    return new Response(JSON.stringify({ message: 'Action not implemented in Edge Function. Please use the client-side session generation or a dedicated Python bridge.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
