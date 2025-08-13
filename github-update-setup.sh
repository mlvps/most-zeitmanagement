#!/bin/bash
# 🚀 GitHub Auto-Update Setup Script

echo "🚀 MO:ST Zeitmanagement - GitHub Auto-Update Setup"
echo "================================================="

# 1. Get GitHub username
read -p "📝 Dein GitHub Username: " GITHUB_USER

if [ -z "$GITHUB_USER" ]; then
    echo "❌ GitHub Username ist erforderlich!"
    exit 1
fi

echo "✅ GitHub Username: $GITHUB_USER"

# 2. Update package.json with correct username
echo "🔧 Aktualisiere package.json..."
sed -i '' "s/DEIN-USERNAME/$GITHUB_USER/g" package.json

# 3. Update main.js with correct username
echo "🔧 Aktualisiere main.js..."
sed -i '' "s/DEIN-USERNAME/$GITHUB_USER/g" main.js

# 4. Create Git repository
echo "📁 Erstelle Git Repository..."
git init
git add .
git commit -m "Initial commit: MO:ST Zeitmanagement v1.0.0"

# 5. Show next steps
echo ""
echo "🎯 NÄCHSTE SCHRITTE:"
echo "==================="
echo ""
echo "1. 📂 Erstelle GitHub Repository:"
echo "   - Gehe zu: https://github.com/new"
echo "   - Name: 'most-zeitmanagement'"
echo "   - ✅ Private (Code versteckt, Releases öffentlich)"
echo "   - ✅ Create repository"
echo ""
echo "2. 🔗 Repository verknüpfen:"
echo "   git remote add origin https://github.com/$GITHUB_USER/most-zeitmanagement.git"
echo "   git branch -M main"
echo "   git push -u origin main"
echo ""
echo "3. 📦 Ersten Release erstellen:"
echo "   - npm run dist"
echo "   - Gehe zu: https://github.com/$GITHUB_USER/most-zeitmanagement/releases"
echo "   - 'Create a new release'"
echo "   - Tag: 'v1.0.0'"
echo "   - Lade die .dmg Datei hoch"
echo ""
echo "4. 🔄 Für Updates:"
echo "   - Ändere 'version' in package.json (z.B. '1.0.1')"
echo "   - npm run dist"
echo "   - Erstelle neuen Release mit neuer Version"
echo "   - 🎉 App updated sich automatisch!"
echo ""
echo "✨ FERTIG! Deine App hat jetzt Auto-Updates!"
