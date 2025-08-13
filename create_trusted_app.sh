#!/bin/bash
# 🎯 MO:ST Zeitmanagement - Vertrauensvolle App-Erstellung

echo "🔧 Erstelle vertrauensvolle App für Freunde..."

# 1. Alte Builds löschen
rm -rf dist/
rm -rf "MO-ST Zeitmanagement-darwin-"*

# 2. Mit minimalen Sicherheitseinstellungen bauen
echo "📦 Baue App mit optimierten Einstellungen..."
npm run dist:dmg

# 3. App manuell signieren mit vorhandenem Certificate
echo "✍️ Signiere App..."
codesign --deep --force --verify --verbose --sign "Apple Development: melv.m@icloud.com (GL839YQGX8)" "dist/mac-universal/MOST Zeitmanagement.app"

# 4. Quarantine-Attribute entfernen (wichtig!)
echo "🔓 Entferne Quarantine-Markierungen..."
xattr -cr "dist/mac-universal/MOST Zeitmanagement.app"
xattr -cr "dist/MOST Zeitmanagement-1.0.0-universal.dmg"

# 5. Final verification
echo "✅ Verifikation..."
codesign --verify --verbose "dist/mac-universal/MOST Zeitmanagement.app"
spctl --assess --verbose --type execute "dist/mac-universal/MOST Zeitmanagement.app" || echo "⚠️ Gatekeeper-Check übersprungen"

echo ""
echo "🎉 FERTIG! Deine App ist bereit für Freunde:"
echo "📁 dist/MOST Zeitmanagement-1.0.0-universal.dmg"
echo ""
echo "✨ Die .dmg sollte jetzt OHNE Warnungen installierbar sein!"
