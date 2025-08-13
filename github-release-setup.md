# 🚀 GitHub Releases Setup - Professionelle Verteilung

## 📦 **Warum GitHub Releases?**
- ✅ **Kostenlos** für öffentliche Repositories
- ✅ **Vertrauenswürdig** - Nutzer sehen den Quellcode
- ✅ **Automatische Updates** möglich
- ✅ **Download-Statistiken**
- ✅ **Versionsverwaltung**

## 🛠️ **Setup Schritte:**

### 1. **Repository erstellen**
```bash
# In deinem Projektordner:
git init
git add .
git commit -m "Initial commit: MO:ST Zeitmanagement v1.0"

# GitHub Repository erstellen und pushen
git remote add origin https://github.com/DEIN-USERNAME/most-zeitmanagement.git
git push -u origin main
```

### 2. **Release erstellen**
1. Gehe zu deinem GitHub Repository
2. Klicke auf "Releases" → "Create a new release"
3. Tag: `v1.0.0`
4. Titel: `MO:ST Zeitmanagement v1.0.0`
5. **Lade die .dmg Datei hoch**
6. Beschreibung:
```markdown
# 🎯 MO:ST Zeitmanagement v1.0.0

## ✨ Features
- ⏱️ Focus Timer mit Overlay
- 📋 Task Management (Todo → Doing → Done)
- 📊 Zeiterfassung & Analytics
- 📝 Schnellnotizen
- 🌙 Dark/Light Mode

## 💻 Installation
1. Lade `MO-ST-Zeitmanagement-STABLE.dmg` herunter
2. **Rechtsklick** auf die App → "Öffnen" (beim ersten Start)
3. Fertig! 🎉

## 🔐 Sicherheitshinweis
Diese App ist nicht von Apple signiert. Verwende den Rechtsklick-Trick für die erste Öffnung.
```

### 3. **Link teilen**
Teile einfach den GitHub Release Link:
`https://github.com/DEIN-USERNAME/most-zeitmanagement/releases/latest`
