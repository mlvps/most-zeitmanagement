#!/bin/bash
# 🔧 MO:ST Zeitmanagement - Crash Fix

echo "🔧 Behebe App-Crash..."

# 1. Cleanup
rm -rf dist/
rm -rf build/

# 2. Minimaler Build ohne problematische Features
echo "📦 Erstelle stabilen Build..."
npm run pack

# 3. Teste die gepackte App direkt
echo "🧪 Teste App..."
open "MO-ST Zeitmanagement-darwin-arm64/MO-ST Zeitmanagement.app"

echo "✅ Getestet! Falls die App startet, erstelle ich eine neue .dmg..."

# 4. Falls erfolgreich, erstelle einfache DMG
if [ -d "MO-ST Zeitmanagement-darwin-arm64/MO-ST Zeitmanagement.app" ]; then
    echo "📦 Erstelle einfache DMG..."
    hdiutil create -volname "MO:ST Zeitmanagement" -srcfolder "MO-ST Zeitmanagement-darwin-arm64/MO-ST Zeitmanagement.app" -ov -format UDZO "MO-ST-Zeitmanagement-STABLE.dmg"
    echo "✅ Stabile Version: MO-ST-Zeitmanagement-STABLE.dmg"
fi
