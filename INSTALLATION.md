# 🍎 MO:ST Zeitmanagement - Installation

## 📥 Für deine Freunde (einfache Installation)

### ✅ **Option 1: .dmg Datei (EMPFOHLEN)**
1. **Lade die Datei herunter:** `MOST Zeitmanagement-1.0.0-universal.dmg`
2. **Doppelklick** auf die .dmg Datei
3. **Ziehe die App** in den Applications-Ordner
4. **Fertig!** 🎉

### ⚠️ **Falls macOS "beschädigt" sagt:**

**Das ist normal und sicher zu beheben:**

1. **Öffne Terminal** (⌘ + Leertaste → "Terminal")
2. **Kopiere und führe aus:**
   ```bash
   sudo xattr -rd com.apple.quarantine "/Applications/MO-ST Zeitmanagement.app"
   ```
3. **Gib dein Passwort ein** (unsichtbar beim Tippen)
4. **Starte die App** - funktioniert jetzt! ✅

### 🔐 **Warum passiert das?**
- macOS Gatekeeper blockiert Apps von unbekannten Entwicklern
- Die App ist **100% sicher** - nur nicht offiziell signiert
- Der `xattr` Befehl entfernt die Quarantäne-Markierung

### 📱 **Teilen via SMS/AirDrop:**
- Sende die **.dmg Datei** (nicht den .app Ordner)
- Größe: ~100MB
- Funktioniert auf **allen Macs** (Intel + Apple Silicon)

### 🆘 **Probleme?**
Falls es nicht funktioniert:
1. **Rechtsklick** auf die App → "Öffnen"
2. Klicke **"Öffnen"** im Dialog
3. Oder: Systemeinstellungen → Sicherheit → "Trotzdem öffnen"

---

## 🛠️ **Für Entwickler**

### Build Commands:
```bash
npm run dist:dmg    # Erstellt .dmg für Distribution
npm run pack        # Erstellt .app Ordner
npm start           # Entwicklung
```

### Technische Details:
- **Universal Binary** (Intel + Apple Silicon)
- **Electron 31.7.7**
- **Signiert** mit Apple Development Certificate
- **Kategorie:** Productivity

---

*Erstellt mit ❤️ für produktives Zeitmanagement*
