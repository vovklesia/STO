-- ============================================================
-- 007_fix_pgcron_always_send.sql
-- 🔧 Виправлення: сервер ЗАВЖДИ відправляє Telegram
-- Більше не залежить від heartbeat / відкритого сайту
-- ============================================================

-- ────────────────────────────────────────
-- 1. Переконатись що pg_cron та pg_net увімкнені
-- ────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ────────────────────────────────────────
-- 2. Перевірити поточний стан cron-задач
-- (виконайте SELECT щоб побачити результат)
-- ────────────────────────────────────────

-- SELECT * FROM cron.job;
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;

-- ────────────────────────────────────────
-- 3. Видалити стару задачу (якщо є)
-- ────────────────────────────────────────

SELECT cron.unschedule('check-reminders-every-minute')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'check-reminders-every-minute'
);

-- ────────────────────────────────────────
-- 4. Створити нову задачу
-- ⚠️ ВАЖЛИВО: замініть <YOUR_SUPABASE_URL> та <YOUR_SERVICE_ROLE_KEY>
--    на реальні значення з Supabase Dashboard → Settings → API
-- ────────────────────────────────────────

-- Варіант А: через current_setting (якщо налаштовано app.settings)
SELECT cron.schedule(
  'check-reminders-every-minute',
  '* * * * *',
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
-- Варіант Б: ЯКЩО Варіант А НЕ ПРАЦЮЄ
-- (current_setting повертає NULL)
-- Розкоментуйте блок нижче та вставте ваш service_role_key:
-- ────────────────────────────────────────

/*
-- Спочатку видалити задачу з Варіанту А:
-- SELECT cron.unschedule('check-reminders-every-minute');

SELECT cron.schedule(
  'check-reminders-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hprzwzqfdnryysqutenc.supabase.co/functions/v1/check-reminders',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <YOUR_SERVICE_ROLE_KEY>"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
*/

-- ────────────────────────────────────────
-- 5. Налаштувати service_role_key в PostgreSQL
-- (потрібно для Варіанту А)
-- Замініть <YOUR_SERVICE_ROLE_KEY> на реальний ключ
-- ────────────────────────────────────────

-- ALTER DATABASE postgres SET app.settings.service_role_key = '<YOUR_SERVICE_ROLE_KEY>';

-- ────────────────────────────────────────
-- 6. Діагностика: перевірити чи все працює
-- Виконайте ці запити після налаштування:
-- ────────────────────────────────────────

-- Перевірити чи задача створена:
-- SELECT jobid, schedule, command, jobname FROM cron.job;

-- Перевірити останні виконання:
-- SELECT jobid, job_pid, status, return_message, start_time, end_time 
-- FROM cron.job_run_details 
-- ORDER BY start_time DESC LIMIT 10;

-- Перевірити чи pg_net відправив HTTP запити:
-- SELECT id, method, url, status_code, created 
-- FROM net._http_response 
-- ORDER BY created DESC LIMIT 10;

-- Перевірити чи service_role_key доступний:
-- SELECT current_setting('app.settings.service_role_key', true);

-- Перевірити логи нагадувань:
-- SELECT * FROM atlas_reminder_logs ORDER BY created_at DESC LIMIT 20;
