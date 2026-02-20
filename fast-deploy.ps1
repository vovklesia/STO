$ErrorActionPreference = "Stop"

# 1. Швидкий білд локально
Write-Host "🚀 [1/3] Building locally..." -ForegroundColor Cyan
npm run build:vercel

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed!" -ForegroundColor Red
    exit 1
}

# 2. Видаляємо стару прив'язку, щоб уникнути конфліктів (опціонально, але надійно)
if (Test-Path ".vercel") {
    Remove-Item -Recurse -Force ".vercel"
}

# 3. Деплой готової папки dist
Write-Host "🚀 [2/3] Deploying to Vercel (vovklesia)..." -ForegroundColor Cyan

# --prod: деплоїть у продакшн
# --yes: відповідає "так" на всі питання
# dist: вказує, що ми заливаємо ВЖЕ ГОТОВУ папку, а не вихідний код
# --token: використовуємо токен, якщо є (автоматично бере з Vercel CLI)
vercel deploy dist --prod --yes --name vovklesia 

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ [3/3] Deployment successful!" -ForegroundColor Green
    Start-Process "https://vovklesia.vercel.app"
} else {
    Write-Host "❌ Deployment failed. Try 'vercel login' first." -ForegroundColor Red
}
