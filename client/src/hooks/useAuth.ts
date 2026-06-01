import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { User as SupabaseUser } from '@supabase/supabase-js';

export interface AuthUser {
  id: string;
  email: string;
  user_metadata?: {
    full_name?: string;
    picture?: string;
  };
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check current session
    const checkAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          setUser({
            id: session.user.id,
            email: session.user.email || '',
            user_metadata: session.user.user_metadata,
          });
        }
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'خطأ في التحقق من المصادقة');
        setLoading(false);
      }
    };

    checkAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email || '',
          user_metadata: session.user.user_metadata,
        });
      } else {
        setUser(null);
      }
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  const signInWithGoogle = async () => {
    try {
      setLoading(true);
      setError(null);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'خطأ في تسجيل الدخول';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    try {
      setLoading(true);
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setUser(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'خطأ في تسجيل الخروج';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return {
    user,
    loading,
    error,
    signInWithGoogle,
    signOut,
  };
}
