#!/bin/bash

# Vercel Deploy Script for vovklesia project
# Usage: ./deploy-vercel.sh

set -e

echo "========================================"
echo "  Deploy to Vercel - vovklesia"
echo "========================================"
echo ""

# Step 1: Clean .vercel folder
echo "[1/4] Cleaning .vercel folder..."
if [ -d ".vercel" ]; then
    rm -rf .vercel
    echo "✓ Cleared existing .vercel folder"
fi

# Step 2: Link to Vercel project
echo "[2/4] Linking to Vercel project..."
vercel link --project vovklesia --yes

if [ $? -ne 0 ]; then
    echo "❌ Project linking failed!"
    exit 1
fi

# Step 3: Build project
echo "[3/4] Building project..."
npm run build:vercel

if [ $? -ne 0 ]; then
    echo "❌ Build failed!"
    exit 1
fi

# Step 4: Deploy to production
echo "[4/4] Deploying to Vercel production..."
vercel --prod --yes --force

if [ $? -eq 0 ]; then
    echo ""
    echo "========================================"
    echo "  ✓ Deploy successful!"
    echo "  URL: https://vovklesia.vercel.app"
    echo "========================================"
else
    echo "❌ Deploy failed!"
    exit 1
fi
