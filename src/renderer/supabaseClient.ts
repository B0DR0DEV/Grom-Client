import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://hfvsqgerfuiovtcfdmbt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmdnNxZ2VyZnVpb3Z0Y2ZkbWJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMTM0NzgsImV4cCI6MjEwNjc4OTQ3OH0.hAULmMeRc1QDZTEPXvWxzQO1JCATDuEY7gTHe5pVPq8';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 10 } },
});