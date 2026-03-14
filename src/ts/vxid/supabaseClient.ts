// src/ts/vxid/supabaseClient.ts
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_CONFIG } from "../../config/project.config";

const SUPABASE_URL = SUPABASE_CONFIG.url;
const SUPABASE_KEY = SUPABASE_CONFIG.anonKey;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("❌ Відсутні ключі Supabase у файлі .env");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  realtime: {
    params: {
      eventsPerSecond: 10, // Ліміт подій на секунду
    },
  },
});
