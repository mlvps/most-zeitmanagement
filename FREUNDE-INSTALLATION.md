# 🚀 MO:ST Zeitmanagement - Installation für Freunde

## ⚠️ Wichtig: macOS Sicherheitswarnung umgehen

### 📱 **Schritt 1: App herunterladen**
1. Lade die `MO-ST-Zeitmanagement-STABLE.dmg` herunter
2. Doppelklick auf die .dmg Datei
3. Ziehe die App in den Applications Ordner

### 🔓 **Schritt 2: Erste Öffnung (Sicherheit umgehen)**
**WICHTIG:** Die App wird beim ersten Start blockiert!

#### **Methode A - Rechtsklick Trick (Empfohlen):**
1. Gehe zu `Applications` im Finder
2. Finde `MO:ST Zeitmanagement.app`
3. **RECHTSKLICK** auf die App
4. Wähle **"Öffnen"** aus dem Kontextmenü
5. Klicke **"Öffnen"** im Warnungsdialog
6. ✅ Ab jetzt startet die App normal!

#### **Methode B - Terminal Befehl:**
```bash
sudo xattr -rd com.apple.quarantine "/Applications/MO-ST Zeitmanagement.app"
```

### 🎉 **Fertig!**
Die App sollte jetzt normal funktionieren und kann wie jede andere App gestartet werden.

---

## 🤔 **Warum passiert das?**
- Die App ist nicht von Apple signiert
- macOS blockiert "unbekannte" Entwickler standardmäßig
- Der Rechtsklick-Trick ist Apples offizielle Methode für vertrauenswürdige Apps

## 🆘 **Probleme?**
Falls es immer noch nicht funktioniert:
1. Öffne `Systemeinstellungen` → `Sicherheit & Datenschutz`
2. Klicke auf `Trotzdem öffnen` bei MO:ST Zeitmanagement
