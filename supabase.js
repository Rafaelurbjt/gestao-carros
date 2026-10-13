import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://adbbjcfudfpfeinrfvhv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkYmJqY2Z1ZGZwZmVpbnJmdmh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1Njc4OTQsImV4cCI6MjEwNzE0Mzg5NH0.umdpxoMX7GaqzehrP8GH2sXua_TXaA1KodbEIZCxeV0';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,      // mantém o login ao fechar e abrir o app
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});