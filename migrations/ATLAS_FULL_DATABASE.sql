-- ════════════════════════════════════════════════════════════════════════════
-- 🧠 АТЛАС — ПОВНА БАЗА ДАНИХ (єдиний файл)
-- Усі таблиці, індекси, RPC-функції, тригери, RLS, pg_cron
-- Для проєкту: STO (hprzwzqfdnryysqutenc.supabase.co)
-- Дата: 2026-03-06
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ ІНСТРУКЦІЯ:
--   1. Виконайте в Supabase SQL Editor (Dashboard → SQL → New Query)
--   2. Замініть <YOUR_SERVICE_ROLE_KEY> на реальний ключ із Settings → API
--   3. Переконайтесь що розширення pg_cron та pg_net увімкнені
--      (Dashboard → Database → Extensions)
--   4. Після виконання задеплойте Edge Functions:
--      npx supabase functions deploy check-reminders --project-ref hprzwzqfdnryysqutenc --no-verify-jwt
--      npx supabase functions deploy send-telegram --project-ref hprzwzqfdnryysqutenc --no-verify-jwt
--      npx supabase functions deploy telegram-bot --project-ref hprzwzqfdnryysqutenc --no-verify-jwt
--
-- ════════════════════════════════════════════════════════════════════════════


-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  ЧАСТИНА 1: РОЗШИРЕННЯ                                                  │
-- └─────────────────────────────────────────────────────────────────────────┘

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;


-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  ЧАСТИНА 2: СИСТЕМА НАГАДУВАНЬ (reminders, logs, telegram, heartbeat)    │
-- └─────────────────────────────────────────────────────────────────────────┘

-- ── 2.1 atlas_reminders ──

CREATE TABLE IF NOT EXISTS atlas_reminders (
  reminder_id    BIGSERIAL PRIMARY KEY,
  created_by     BIGINT REFERENCES slyusars(slyusar_id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),

  title          TEXT NOT NULL,
  description    TEXT DEFAULT NULL,

  reminder_type  TEXT NOT NULL DEFAULT 'once'
    CHECK (reminder_type IN ('once', 'recurring', 'conditional')),

  -- Для 'once': конкретна дата/час
  trigger_at     TIMESTAMPTZ DEFAULT NULL,

  -- Для 'recurring': правило повторення (JSON)
  -- {"type":"daily","time":"09:00"}
  -- {"type":"weekly","days":["mon","wed","fri"],"time":"08:30"}
  -- {"type":"monthly","day":15,"time":"10:00"}
  -- {"type":"interval","hours":4}
  schedule       JSONB DEFAULT NULL,

  -- Для 'conditional': SQL SELECT який перевіряє умову
  condition_query TEXT DEFAULT NULL,
  condition_check_interval TEXT DEFAULT '1 hour',

  -- Адресати: 'self', 'all', 'mechanics', або [1, 5, 12]
  recipients     JSONB DEFAULT '"self"'::jsonb,

  -- Канал: app (toast), telegram, both
  channel        TEXT NOT NULL DEFAULT 'app'
    CHECK (channel IN ('app', 'telegram', 'both')),

  priority       TEXT DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),

  status         TEXT DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),

  last_triggered_at  TIMESTAMPTZ DEFAULT NULL,
  next_trigger_at    TIMESTAMPTZ DEFAULT NULL,
  trigger_count      INTEGER DEFAULT 0,

  -- Додаткові дані: {"color":"#FF5733","icon":"🔧","tags":["фінанси"]}
  meta           JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_reminders_status ON atlas_reminders(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_reminders_next_trigger ON atlas_reminders(next_trigger_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_reminders_created_by ON atlas_reminders(created_by);
CREATE INDEX IF NOT EXISTS idx_reminders_type ON atlas_reminders(reminder_type);

COMMENT ON TABLE atlas_reminders IS '🔔 Система нагадувань Атласа: одноразові, повторювані та умовні';

-- ── 2.2 atlas_reminder_logs ──

CREATE TABLE IF NOT EXISTS atlas_reminder_logs (
  log_id         BIGSERIAL PRIMARY KEY,
  reminder_id    BIGINT NOT NULL REFERENCES atlas_reminders(reminder_id) ON DELETE CASCADE,
  recipient_id   BIGINT REFERENCES slyusars(slyusar_id) ON DELETE SET NULL,
  recipient_name TEXT DEFAULT NULL,
  channel        TEXT NOT NULL CHECK (channel IN ('app', 'telegram')),
  message_text   TEXT NOT NULL,

  delivery_status TEXT DEFAULT 'sent'
    CHECK (delivery_status IN ('sent', 'delivered', 'read', 'failed', 'dismissed', 'callback')),

  sent_at        TIMESTAMPTZ DEFAULT NOW(),
  delivered_at   TIMESTAMPTZ DEFAULT NULL,
  read_at        TIMESTAMPTZ DEFAULT NULL,
  condition_data JSONB DEFAULT NULL,
  error_message  TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_reminder_logs_reminder ON atlas_reminder_logs(reminder_id);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_recipient ON atlas_reminder_logs(recipient_id);
CREATE INDEX IF NOT EXISTS idx_reminder_logs_status ON atlas_reminder_logs(delivery_status)
  WHERE delivery_status IN ('sent', 'delivered');
CREATE INDEX IF NOT EXISTS idx_reminder_logs_sent ON atlas_reminder_logs(sent_at DESC);

COMMENT ON TABLE atlas_reminder_logs IS '📋 Журнал доставки нагадувань';

-- ── 2.3 atlas_telegram_users ──

CREATE TABLE IF NOT EXISTS atlas_telegram_users (
  id             BIGSERIAL PRIMARY KEY,
  slyusar_id     BIGINT NOT NULL UNIQUE REFERENCES slyusars(slyusar_id) ON DELETE CASCADE,
  telegram_chat_id BIGINT NOT NULL UNIQUE,
  telegram_username TEXT DEFAULT NULL,
  linked_at      TIMESTAMPTZ DEFAULT NOW(),
  is_active      BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_telegram_users_slyusar ON atlas_telegram_users(slyusar_id);
CREATE INDEX IF NOT EXISTS idx_telegram_users_chat ON atlas_telegram_users(telegram_chat_id);

COMMENT ON TABLE atlas_telegram_users IS '🔗 Зв''язок Telegram акаунтів з працівниками СТО';

-- ── 2.4 atlas_app_heartbeat ──

CREATE TABLE IF NOT EXISTS atlas_app_heartbeat (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  slyusar_id INTEGER
);

INSERT INTO atlas_app_heartbeat (id, last_seen_at)
VALUES (1, '2000-01-01'::timestamptz)
ON CONFLICT (id) DO NOTHING;

-- ── 2.5 ai_chats ──

CREATE TABLE IF NOT EXISTS public."ai_chats" (
  "chat_id" SERIAL PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "title" TEXT DEFAULT 'Новий чат',
  "created_at" TIMESTAMPTZ DEFAULT now(),
  "updated_at" TIMESTAMPTZ DEFAULT now(),
  "favorites" BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_ai_chats_user ON public."ai_chats"(user_id);

-- ── 2.6 ai_messages ──

CREATE TABLE IF NOT EXISTS public."ai_messages" (
  "message_id" SERIAL PRIMARY KEY,
  "chat_id" INT REFERENCES public."ai_chats"("chat_id") ON DELETE CASCADE,
  "role" TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  "text" TEXT NOT NULL DEFAULT '',
  "images" TEXT[] DEFAULT '{}',
  "created_at" TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_chat ON public."ai_messages"(chat_id);

-- ── 2.7 Додаткові індекси для acts/cars/clients ──

-- FK-індекси (зв'язки)
CREATE INDEX IF NOT EXISTS "idx_acts_client_id" ON public."acts"("client_id");
CREATE INDEX IF NOT EXISTS "idx_acts_cars_id" ON public."acts"("cars_id");
CREATE INDEX IF NOT EXISTS "idx_cars_client_id" ON public."cars"("client_id");

-- Дати актів (сортування, фільтрація)
CREATE INDEX IF NOT EXISTS "idx_acts_date_on" ON public."acts"("date_on" DESC);
CREATE INDEX IF NOT EXISTS "idx_acts_date_off" ON public."acts"("date_off");

-- Відкриті акти (date_off IS NULL)
CREATE INDEX IF NOT EXISTS "idx_acts_open" ON public."acts"("date_on" DESC) WHERE "date_off" IS NULL;

-- Приймальник
CREATE INDEX IF NOT EXISTS "idx_acts_pruimalnyk" ON public."acts"("pruimalnyk") WHERE "pruimalnyk" IS NOT NULL;


-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  ЧАСТИНА 3: RLS (Row Level Security)                                    │
-- └─────────────────────────────────────────────────────────────────────────┘

ALTER TABLE atlas_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_reminder_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_telegram_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_app_heartbeat ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ai_chats" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ai_messages" ENABLE ROW LEVEL SECURITY;

-- Політики: authenticated може все
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'atlas_reminders_all') THEN
    CREATE POLICY "atlas_reminders_all" ON atlas_reminders FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'atlas_reminder_logs_all') THEN
    CREATE POLICY "atlas_reminder_logs_all" ON atlas_reminder_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'atlas_telegram_users_all') THEN
    CREATE POLICY "atlas_telegram_users_all" ON atlas_telegram_users FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all for ai_chats') THEN
    CREATE POLICY "Allow all for ai_chats" ON public."ai_chats" FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow all for ai_messages') THEN
    CREATE POLICY "Allow all for ai_messages" ON public."ai_messages" FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;


-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  ЧАСТИНА 4: RPC-ФУНКЦІЇ                                                 │
-- └─────────────────────────────────────────────────────────────────────────┘

-- ── 4.1 get_due_reminders — нагадування які прямо зараз мають спрацювати ──

CREATE OR REPLACE FUNCTION get_due_reminders()
RETURNS TABLE (
  reminder_id    BIGINT,
  title          TEXT,
  description    TEXT,
  reminder_type  TEXT,
  recipients     JSONB,
  channel        TEXT,
  priority       TEXT,
  condition_query TEXT,
  schedule       JSONB,
  trigger_count  INTEGER,
  created_by     BIGINT,
  creator_name   TEXT,
  meta           JSONB
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    r.reminder_id, r.title, r.description, r.reminder_type,
    r.recipients, r.channel, r.priority, r.condition_query,
    r.schedule, r.trigger_count, r.created_by,
    COALESCE(s.data->>'Name', '—') AS creator_name,
    r.meta
  FROM atlas_reminders r
  LEFT JOIN slyusars s ON s.slyusar_id = r.created_by
  WHERE r.status = 'active'
    AND r.next_trigger_at IS NOT NULL
    AND r.next_trigger_at <= NOW()
  ORDER BY
    CASE r.priority
      WHEN 'urgent' THEN 1
      WHEN 'high'   THEN 2
      WHEN 'normal' THEN 3
      WHEN 'low'    THEN 4
    END,
    r.next_trigger_at ASC;
$$;

GRANT EXECUTE ON FUNCTION get_due_reminders() TO authenticated;

-- ── 4.2 get_my_reminders — нагадування конкретного користувача ──

CREATE OR REPLACE FUNCTION get_my_reminders(p_slyusar_id BIGINT)
RETURNS TABLE (
  reminder_id    BIGINT,
  title          TEXT,
  description    TEXT,
  reminder_type  TEXT,
  trigger_at     TIMESTAMPTZ,
  schedule       JSONB,
  recipients     JSONB,
  channel        TEXT,
  priority       TEXT,
  status         TEXT,
  created_at     TIMESTAMPTZ,
  next_trigger_at TIMESTAMPTZ,
  last_triggered_at TIMESTAMPTZ,
  trigger_count  INTEGER,
  creator_name   TEXT,
  is_mine        BOOLEAN,
  meta           JSONB
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    r.reminder_id, r.title, r.description, r.reminder_type,
    r.trigger_at, r.schedule, r.recipients, r.channel,
    r.priority, r.status, r.created_at, r.next_trigger_at,
    r.last_triggered_at, r.trigger_count,
    COALESCE(s.data->>'Name', '—') AS creator_name,
    (r.created_by = p_slyusar_id) AS is_mine,
    r.meta
  FROM atlas_reminders r
  LEFT JOIN slyusars s ON s.slyusar_id = r.created_by
  WHERE r.status IN ('active', 'paused')
    AND (
      r.created_by = p_slyusar_id
      OR r.recipients = '"all"'::jsonb
      OR r.recipients = '"mechanics"'::jsonb
      OR r.recipients = '"self"'::jsonb AND r.created_by = p_slyusar_id
      OR r.recipients @> to_jsonb(p_slyusar_id)
    )
  ORDER BY
    r.status ASC,
    CASE r.priority
      WHEN 'urgent' THEN 1
      WHEN 'high'   THEN 2
      WHEN 'normal' THEN 3
      WHEN 'low'    THEN 4
    END,
    COALESCE(r.next_trigger_at, r.trigger_at, r.created_at) ASC;
$$;

GRANT EXECUTE ON FUNCTION get_my_reminders(BIGINT) TO authenticated;

-- ── 4.3 trigger_reminder — позначити нагадування як спрацьоване ──

CREATE OR REPLACE FUNCTION trigger_reminder(p_reminder_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_type TEXT;
  v_schedule JSONB;
  v_next TIMESTAMPTZ;
BEGIN
  SELECT reminder_type, schedule
  INTO v_type, v_schedule
  FROM atlas_reminders
  WHERE reminder_id = p_reminder_id;

  IF v_type = 'once' THEN
    UPDATE atlas_reminders SET
      status = 'completed',
      last_triggered_at = NOW(),
      trigger_count = trigger_count + 1,
      next_trigger_at = NULL,
      updated_at = NOW()
    WHERE reminder_id = p_reminder_id;

  ELSIF v_type IN ('recurring', 'conditional') THEN
    v_next := NULL;

    IF v_schedule IS NOT NULL THEN
      IF v_schedule->>'type' = 'daily' THEN
        v_next := (CURRENT_DATE + 1)::TIMESTAMPTZ
                  + (COALESCE(v_schedule->>'time', '09:00'))::TIME;

      ELSIF v_schedule->>'type' = 'weekly' THEN
        v_next := NOW() + INTERVAL '7 days';

      ELSIF v_schedule->>'type' = 'monthly' THEN
        v_next := (DATE_TRUNC('month', NOW()) + INTERVAL '1 month')::DATE
                  + (COALESCE((v_schedule->>'day')::INT - 1, 0)) * INTERVAL '1 day'
                  + (COALESCE(v_schedule->>'time', '09:00'))::TIME;

      ELSIF v_schedule->>'type' = 'interval' THEN
        v_next := NOW() + (COALESCE((v_schedule->>'hours')::INT, 1)) * INTERVAL '1 hour';
      END IF;
    ELSE
      v_next := NOW() + INTERVAL '1 hour';
    END IF;

    UPDATE atlas_reminders SET
      last_triggered_at = NOW(),
      trigger_count = trigger_count + 1,
      next_trigger_at = v_next,
      updated_at = NOW()
    WHERE reminder_id = p_reminder_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION trigger_reminder(BIGINT) TO authenticated;

-- ── 4.4 execute_condition_query — безпечне виконання SELECT для conditional ──

CREATE OR REPLACE FUNCTION execute_condition_query(query_text TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  row_count INTEGER := 0;
BEGIN
  IF query_text IS NULL OR TRIM(query_text) = '' THEN
    RETURN 0;
  END IF;

  IF NOT (UPPER(TRIM(query_text)) LIKE 'SELECT%') THEN
    RAISE EXCEPTION 'Дозволені тільки SELECT-запити';
  END IF;

  IF UPPER(query_text) ~ '(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|EXECUTE)' THEN
    RAISE EXCEPTION 'Запит містить заборонені операції';
  END IF;

  EXECUTE 'SELECT COUNT(*) FROM (' || query_text || ') AS _cq' INTO row_count;

  RETURN COALESCE(row_count, 0);
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'execute_condition_query error: %', SQLERRM;
    RETURN 0;
END;
$$;

GRANT EXECUTE ON FUNCTION execute_condition_query(TEXT) TO authenticated;

-- ── 4.5 get_telegram_link_status — статус прив'язки Telegram ──

CREATE OR REPLACE FUNCTION get_telegram_link_status(p_slyusar_id BIGINT)
RETURNS TABLE (
  is_linked    BOOLEAN,
  is_active    BOOLEAN,
  telegram_username TEXT,
  linked_at    TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT TRUE, t.is_active, t.telegram_username, t.linked_at
  FROM atlas_telegram_users t
  WHERE t.slyusar_id = p_slyusar_id

  UNION ALL

  SELECT FALSE, FALSE, NULL, NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM atlas_telegram_users WHERE slyusar_id = p_slyusar_id
  )

  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_telegram_link_status(BIGINT) TO authenticated;

-- ── 4.6 update_app_heartbeat — клієнт оновлює heartbeat ──

CREATE OR REPLACE FUNCTION update_app_heartbeat(p_slyusar_id INTEGER DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE atlas_app_heartbeat
  SET last_seen_at = NOW(),
      slyusar_id = COALESCE(p_slyusar_id, slyusar_id)
  WHERE id = 1;
END;
$$;

-- ── 4.7 is_client_alive — перевірити чи клієнт (сайт) активний ──

CREATE OR REPLACE FUNCTION is_client_alive(threshold_seconds INTEGER DEFAULT 75)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM atlas_app_heartbeat
    WHERE id = 1
    AND last_seen_at > NOW() - make_interval(secs => threshold_seconds)
  );
END;
$$;




-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  ЧАСТИНА 5: ТРИГЕРИ                                                     │
-- └─────────────────────────────────────────────────────────────────────────┘

CREATE OR REPLACE FUNCTION update_reminder_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reminder_updated ON atlas_reminders;
CREATE TRIGGER trg_reminder_updated
  BEFORE UPDATE ON atlas_reminders
  FOR EACH ROW
  EXECUTE FUNCTION update_reminder_timestamp();


-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  ЧАСТИНА 6: PG_CRON — автоматична перевірка нагадувань кожну хвилину    │
-- └─────────────────────────────────────────────────────────────────────────┘

-- ⚠️ ЗАМІНІТЬ <YOUR_SERVICE_ROLE_KEY> на реальний ключ!
-- Знайти: Supabase Dashboard → Settings → API → service_role (secret)

-- Видалити стару задачу (якщо є)
DO $$ BEGIN
  PERFORM cron.unschedule('check-reminders-every-minute');
EXCEPTION WHEN OTHERS THEN
  -- Задача не існує, це нормально
END $$;

-- Створити нову задачу
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


-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  ЧАСТИНА 7: ДІАГНОСТИКА (після налаштування)                            │
-- └─────────────────────────────────────────────────────────────────────────┘

-- Перевірити cron-задачі:
-- SELECT jobid, schedule, jobname FROM cron.job;

-- Перевірити останні виконання:
-- SELECT status, return_message, start_time FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;

-- Перевірити HTTP відповіді (200 = ОК):
-- SELECT id, status_code, created FROM net._http_response ORDER BY created DESC LIMIT 5;

-- Перевірити активні нагадування:
-- SELECT reminder_id, title, channel, next_trigger_at, status FROM atlas_reminders WHERE status = 'active';

-- Перевірити Telegram прив'язки:
-- SELECT slyusar_id, telegram_chat_id, is_active FROM atlas_telegram_users;

-- Перевірити логи доставки:
-- SELECT * FROM atlas_reminder_logs ORDER BY sent_at DESC LIMIT 20;


-- ════════════════════════════════════════════════════════════════════════════
-- ✅ ГОТОВО
-- ════════════════════════════════════════════════════════════════════════════
