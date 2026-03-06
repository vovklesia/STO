-- ════════════════════════════════════════════════════════════════
-- 🔍 DEBUG: Повна діагностика системи нагадувань Атласа
-- Виконайте ці запити в Supabase SQL Editor (Dashboard → SQL)
-- ════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════
-- 1. 💓 HEARTBEAT — чи вважає сервер, що клієнт живий?
-- ══════════════════════════════════════

SELECT 
  '💓 HEARTBEAT' AS section,
  last_seen_at,
  slyusar_id,
  NOW() AS server_now,
  ROUND(EXTRACT(EPOCH FROM (NOW() - last_seen_at))) AS seconds_ago,
  CASE 
    WHEN last_seen_at > NOW() - INTERVAL '75 seconds' THEN '🟢 КЛІЄНТ ЖИВИЙ (сервер пропустить)'
    ELSE '🔴 КЛІЄНТ МЕРТВИЙ (сервер має обробити)'
  END AS client_status
FROM atlas_app_heartbeat
WHERE id = 1;


-- ══════════════════════════════════════
-- 2. 🔔 ВСІ АКТИВНІ НАГАДУВАННЯ
-- ══════════════════════════════════════

SELECT 
  '🔔 АКТИВНІ' AS section,
  r.reminder_id,
  r.title,
  r.reminder_type,
  r.channel,
  r.priority,
  r.status,
  r.trigger_at,
  r.next_trigger_at,
  r.last_triggered_at,
  r.trigger_count,
  r.recipients,
  r.schedule,
  r.condition_query,
  r.created_by,
  COALESCE(s.data->>'Name', '—') AS creator_name,
  r.created_at,
  r.updated_at
FROM atlas_reminders r
LEFT JOIN slyusars s ON s.slyusar_id = r.created_by
WHERE r.status = 'active'
ORDER BY r.next_trigger_at ASC NULLS LAST;


-- ══════════════════════════════════════
-- 3. ⏰ DUE НАГАДУВАННЯ (ті що мали б спрацювати ПРЯМО ЗАРАЗ)
-- Це саме те, що get_due_reminders() повертає
-- ══════════════════════════════════════

SELECT 
  '⏰ DUE ЗАРАЗ' AS section,
  r.reminder_id,
  r.title,
  r.channel,
  r.priority,
  r.next_trigger_at,
  NOW() AS server_now,
  ROUND(EXTRACT(EPOCH FROM (NOW() - r.next_trigger_at))) AS overdue_seconds,
  r.recipients,
  r.reminder_type,
  r.condition_query,
  r.trigger_count,
  COALESCE(s.data->>'Name', '—') AS creator_name
FROM atlas_reminders r
LEFT JOIN slyusars s ON s.slyusar_id = r.created_by
WHERE r.status = 'active'
  AND r.next_trigger_at IS NOT NULL
  AND r.next_trigger_at <= NOW()
ORDER BY r.next_trigger_at ASC;


-- ══════════════════════════════════════
-- 4. ❌ ПРОБЛЕМНІ: активні БЕЗ next_trigger_at (ніколи не спрацюють!)
-- ══════════════════════════════════════

SELECT 
  '❌ БЕЗ NEXT_TRIGGER' AS section,
  r.reminder_id,
  r.title,
  r.reminder_type,
  r.channel,
  r.trigger_at,
  r.next_trigger_at,
  r.status,
  r.schedule,
  r.created_at
FROM atlas_reminders r
WHERE r.status = 'active'
  AND r.next_trigger_at IS NULL;


-- ══════════════════════════════════════
-- 5. 🔗 TELEGRAM ПРИВ'ЯЗКИ — хто підключений?
-- ══════════════════════════════════════

SELECT 
  '🔗 TELEGRAM' AS section,
  t.slyusar_id,
  COALESCE(s.data->>'Name', '—') AS name,
  t.telegram_chat_id,
  t.telegram_username,
  t.is_active,
  t.linked_at
FROM atlas_telegram_users t
LEFT JOIN slyusars s ON s.slyusar_id = t.slyusar_id
ORDER BY t.is_active DESC, t.linked_at DESC;


-- ══════════════════════════════════════
-- 6. 📋 ОСТАННІ ЛОГИ ДОСТАВКИ (останні 30)
-- ══════════════════════════════════════

SELECT 
  '📋 ЛОГИ' AS section,
  l.log_id,
  l.reminder_id,
  r.title AS reminder_title,
  l.channel,
  l.delivery_status,
  l.message_text,
  l.error_message,
  l.sent_at,
  l.recipient_id,
  COALESCE(s.data->>'Name', '—') AS recipient_name
FROM atlas_reminder_logs l
LEFT JOIN atlas_reminders r ON r.reminder_id = l.reminder_id
LEFT JOIN slyusars s ON s.slyusar_id = l.recipient_id
ORDER BY l.sent_at DESC
LIMIT 30;


-- ══════════════════════════════════════
-- 7. 🕐 PG_CRON — чи працює cron-задача?
-- ══════════════════════════════════════

-- 7a. Список задач
SELECT 
  '🕐 CRON JOBS' AS section,
  jobid, 
  jobname, 
  schedule, 
  active,
  database,
  username
FROM cron.job;

-- 7b. Останні запуски (помилки?)
SELECT 
  '🕐 CRON RUNS' AS section,
  runid,
  jobid,
  job_pid,
  status,
  return_message,
  start_time,
  end_time,
  ROUND(EXTRACT(EPOCH FROM (end_time - start_time))::numeric, 2) AS duration_sec
FROM cron.job_run_details 
ORDER BY start_time DESC 
LIMIT 20;


-- ══════════════════════════════════════
-- 8. 🔑 SERVICE ROLE KEY — чи доступний для pg_cron?
-- Якщо повертає NULL — pg_cron НЕ ЗМОЖЕ викликати Edge Function!
-- ══════════════════════════════════════

SELECT 
  '🔑 SERVICE KEY' AS section,
  current_setting('app.settings.service_role_key', true) IS NOT NULL AS key_exists,
  CASE 
    WHEN current_setting('app.settings.service_role_key', true) IS NULL 
    THEN '🔴 КЛЮЧ НЕ НАЛАШТОВАНИЙ! pg_cron не може викликати Edge Function!'
    ELSE '🟢 Ключ налаштований (довжина: ' || LENGTH(current_setting('app.settings.service_role_key', true))::TEXT || ')'
  END AS key_status;


-- ══════════════════════════════════════
-- 9. 🧪 ТЕСТ: Перевірити RPC get_due_reminders вручну
-- ══════════════════════════════════════

SELECT * FROM get_due_reminders();


-- ══════════════════════════════════════
-- 10. 🧪 ТЕСТ: Перевірити RPC is_client_alive
-- ══════════════════════════════════════

SELECT 
  is_client_alive(75) AS alive_75s,
  is_client_alive(120) AS alive_120s,
  is_client_alive(300) AS alive_5min;


-- ══════════════════════════════════════
-- 11. 📡 PG_NET — перевірити чи розширення увімкнене
-- ══════════════════════════════════════

SELECT 
  '📡 EXTENSIONS' AS section,
  extname, 
  extversion 
FROM pg_extension 
WHERE extname IN ('pg_cron', 'pg_net', 'http');


-- ══════════════════════════════════════
-- 12. 📊 ЗВЕДЕНА СТАТИСТИКА
-- ══════════════════════════════════════

SELECT 
  '📊 СТАТИСТИКА' AS section,
  (SELECT COUNT(*) FROM atlas_reminders WHERE status = 'active') AS active_reminders,
  (SELECT COUNT(*) FROM atlas_reminders WHERE status = 'active' AND next_trigger_at IS NULL) AS broken_no_next_trigger,
  (SELECT COUNT(*) FROM atlas_reminders WHERE status = 'active' AND next_trigger_at <= NOW()) AS due_now,
  (SELECT COUNT(*) FROM atlas_reminders WHERE status = 'completed') AS completed,
  (SELECT COUNT(*) FROM atlas_reminders WHERE status = 'cancelled') AS cancelled,
  (SELECT COUNT(*) FROM atlas_telegram_users WHERE is_active = true) AS telegram_linked,
  (SELECT COUNT(*) FROM atlas_reminder_logs WHERE sent_at > NOW() - INTERVAL '24 hours') AS logs_24h,
  (SELECT COUNT(*) FROM atlas_reminder_logs WHERE delivery_status = 'failed' AND sent_at > NOW() - INTERVAL '24 hours') AS failed_24h;


-- ════════════════════════════════════════════════════════════════
-- 🛠 ФІКСИ (ВИКОНУЙТЕ ТІЛЬКИ ЯКЩО ПРОБЛЕМА ПІДТВЕРДЖЕНА)
-- ════════════════════════════════════════════════════════════════


-- ── FIX 1: Якщо service_role_key = NULL → треба задати ──
-- Замініть <YOUR_SERVICE_ROLE_KEY> на справжній ключ із Supabase Dashboard → Settings → API
-- ALTER DATABASE postgres SET app.settings.service_role_key = '<YOUR_SERVICE_ROLE_KEY>';


-- ── FIX 2: Якщо є активні нагадування без next_trigger_at → встановити ──
-- UPDATE atlas_reminders 
-- SET next_trigger_at = trigger_at 
-- WHERE status = 'active' 
--   AND next_trigger_at IS NULL 
--   AND trigger_at IS NOT NULL;

-- UPDATE atlas_reminders 
-- SET next_trigger_at = NOW() 
-- WHERE status = 'active' 
--   AND next_trigger_at IS NULL 
--   AND trigger_at IS NULL
--   AND reminder_type = 'recurring';


-- ── FIX 3: Перестворити pg_cron з хардкод ключем (якщо current_setting не працює) ──
-- SELECT cron.unschedule('check-reminders-every-minute');
-- SELECT cron.schedule(
--   'check-reminders-every-minute',
--   '* * * * *',
--   $$
--   SELECT net.http_post(
--     url := 'https://hprzwzqfdnryysqutenc.supabase.co/functions/v1/check-reminders',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer <YOUR_SERVICE_ROLE_KEY>'
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );


-- ── FIX 4: Скинути heartbeat (зробити клієнт "мертвим" для тесту) ──
-- UPDATE atlas_app_heartbeat SET last_seen_at = '2000-01-01' WHERE id = 1;
