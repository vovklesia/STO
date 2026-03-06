-- ============================================================
-- 005_pg_cron_check_reminders.sql
-- 🕐 pg_cron — автоматична перевірка нагадувань кожну хвилину
-- Викликає Edge Function "check-reminders" через pg_net
-- ============================================================

-- ⚠️ ВАЖЛИВО: перед виконанням переконайтесь що:
-- 1. pg_cron увімкнений: Supabase Dashboard → Database → Extensions → pg_cron → Enable
-- 2. pg_net увімкнений: Supabase Dashboard → Database → Extensions → pg_net → Enable  
-- 3. Edge Function "check-reminders" задеплоєна:
--    supabase functions deploy check-reminders

-- ────────────────────────────────────────
-- 1. Увімкнути розширення (якщо ще не)
-- ────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ────────────────────────────────────────
-- 2. Створити cron-задачу: кожну хвилину
-- ────────────────────────────────────────

-- Спочатку видалити стару задачу, якщо існує
SELECT cron.unschedule('check-reminders-every-minute')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'check-reminders-every-minute'
);

-- Створити нову задачу
SELECT cron.schedule(
  'check-reminders-every-minute',   -- ім'я задачі
  '* * * * *',                       -- кожну хвилину
  $$
  SELECT net.http_post(
    url := 'https://hprzwzqfdnryysqutenc.supabase.co/functions/v1/check-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ────────────────────────────────────────
-- 3. Альтернативний варіант: використати SUPABASE_SERVICE_ROLE_KEY напряму
-- Якщо current_setting не працює, замініть рядок Authorization на:
-- 'Authorization', 'Bearer <ваш_service_role_key>'
-- ────────────────────────────────────────

-- ────────────────────────────────────────
-- 4. Перевірка: подивитись задачі
-- ────────────────────────────────────────
-- SELECT * FROM cron.job;
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
