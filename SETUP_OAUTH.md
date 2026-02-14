# 🔧 Налаштування OAuth та Supabase для vovklesia

## ⚠️ ВАЖЛИВО: Виконайте ці кроки для правильної роботи авторизації!

---

## 1️⃣ Google Cloud Console - OAuth 2.0

### Крок 1: Перейдіть до Google Cloud Console
🔗 https://console.cloud.google.com/apis/credentials

### Крок 2: Оберіть ваш OAuth 2.0 Client ID
- Client ID: `YOUR_GOOGLE_CLIENT_ID`
- Client Secret: `YOUR_GOOGLE_CLIENT_SECRET`

### Крок 3: Оновіть Authorized redirect URIs

**❌ Видаліть старі URL:**
- `https://vovklesia.vercel.app`
- Всі інші старі URL з `vovklesia`

**✅ Додайте нові URL:**
```
https://vovklesia.vercel.app
https://vovklesia.vercel.app/main.html
https://vovklesia.vercel.app/index.html
https://vovklesia.github.io/STO/
https://vovklesia.github.io/STO/main.html
https://vovklesia.github.io/STO/index.html
https://hprzwzqfdnryysqutenc.supabase.co/auth/v1/callback
http://localhost:5173
http://localhost:5173/main.html
http://localhost:5173/index.html
```

### Крок 4: Збережіть зміни
Натисніть **"SAVE"** внизу сторінки.

---

## 2️⃣ Supabase Dashboard - Authentication

### Крок 1: Перейдіть до Supabase Auth Configuration
🔗 https://supabase.com/dashboard/project/hprzwzqfdnryysqutenc/auth/url-configuration

### Крок 2: Оновіть Site URL
**Site URL:**
```
https://vovklesia.vercel.app
```

### Крок 3: Оновіть Redirect URLs
**Додайте в "Redirect URLs":**
```
https://vovklesia.vercel.app/**
https://vovklesia.github.io/STO/**
http://localhost:5173/**
```

### Крок 4: Налаштуйте Google Provider

Перейдіть: **Authentication → Providers → Google**

🔗 https://supabase.com/dashboard/project/hprzwzqfdnryysqutenc/auth/providers

**Увімкніть Google Provider та вкажіть:**
- **Client ID:** `YOUR_GOOGLE_CLIENT_ID`
- **Client Secret:** `YOUR_GOOGLE_CLIENT_SECRET`

### Крок 5: Збережіть зміни

---

## 3️⃣ Vercel - Environment Variables

### Крок 1: Перейдіть до Vercel Project Settings
🔗 https://vercel.com/vovklesia-projects/vovklesia/settings/environment-variables

### Крок 2: Додайте Environment Variables

**Додайте наступні змінні для всіх середовищ (Production, Preview, Development):**

| Variable Name | Value |
|--------------|-------|
| `VITE_SUPABASE_URL` | `https://hprzwzqfdnryysqutenc.supabase.co` |
| `VITE_SUPABASE_KEY` | `YOUR_SUPABASE_ANON_KEY` |
| `VITE_GOOGLE_CLIENT_ID` | `YOUR_GOOGLE_CLIENT_ID` |

### Крок 3: Redeploy проект
Після додавання змінних, зробіть redeploy:
```bash
vercel --prod --yes
```

---

## 4️⃣ Перевірка налаштувань

### Тестові URL:
- ✅ Vercel: https://vovklesia.vercel.app
- ✅ GitHub Pages: https://vovklesia.github.io/STO/
- ✅ Localhost: http://localhost:5173

### Після налаштування:
1. Очистіть кеш браузера (Ctrl+Shift+Delete)
2. Спробуйте залогінитися на кожному з URL
3. Перевірте, що редірект працює правильно

---

## 🆘 Troubleshooting

### Помилка: "Signups not allowed for this instance"
**Причина:** Supabase має вимкнену реєстрацію нових користувачів.

**Рішення:**
1. Перейдіть: https://supabase.com/dashboard/project/hprzwzqfdnryysqutenc/auth/policies
2. Увімкніть "Enable email signups" або додайте користувачів вручну

### Помилка: "access_denied"
**Причина:** Google OAuth redirect URI не налаштований.

**Рішення:**
1. Перевірте, що всі URL додані в Google Cloud Console
2. Почекайте 5-10 хвилин після збереження змін

---

## ✅ Checklist

- [ ] Оновлено Google OAuth Redirect URIs
- [ ] Оновлено Supabase Site URL
- [ ] Оновлено Supabase Redirect URLs
- [ ] Налаштовано Google Provider в Supabase
- [ ] Додано Environment Variables в Vercel
- [ ] Зроблено redeploy на Vercel
- [ ] Протестовано авторизацію на всіх URL

---

**Після виконання всіх кроків, авторизація буде працювати правильно!** 🎉
