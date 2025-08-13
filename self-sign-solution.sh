#!/bin/bash
# 🔐 Self-Signed Certificate Lösung

echo "🔐 Erstelle selbst-signierte Version..."

# 1. Erstelle selbst-signiertes Zertifikat (einmalig)
create_certificate() {
    echo "📝 Erstelle Entwickler-Zertifikat..."

    # Erstelle privaten Schlüssel
    openssl genrsa -out most-dev.key 2048

    # Erstelle Zertifikat
    openssl req -new -x509 -key most-dev.key -out most-dev.crt -days 365 \
        -subj "/C=DE/ST=Deutschland/L=Stadt/O=MOST Dev/CN=MOST Zeitmanagement"

    # Importiere in Keychain
    security import most-dev.crt -k ~/Library/Keychains/login.keychain
    security import most-dev.key -k ~/Library/Keychains/login.keychain

    echo "✅ Zertifikat erstellt: most-dev.crt"
}

# 2. Signiere die App
sign_app() {
    echo "🖊️ Signiere App..."

    APP_PATH="MO-ST Zeitmanagement-darwin-arm64/MO-ST Zeitmanagement.app"

    if [ -d "$APP_PATH" ]; then
        # Signiere mit selbst-erstelltem Zertifikat
        codesign --force --sign "MOST Zeitmanagement" "$APP_PATH"

        # Erstelle neue DMG
        hdiutil create -volname "MO:ST Zeitmanagement" \
            -srcfolder "$APP_PATH" \
            -ov -format UDZO \
            "MO-ST-Zeitmanagement-SELF-SIGNED.dmg"

        echo "✅ Selbst-signierte Version: MO-ST-Zeitmanagement-SELF-SIGNED.dmg"
    else
        echo "❌ App nicht gefunden. Führe zuerst './fix_crash.sh' aus."
    fi
}

# 3. Hauptfunktion
main() {
    echo "🎯 Self-Signed Certificate Lösung"
    echo "1. Zertifikat erstellen (einmalig)"
    echo "2. App signieren"
    echo ""

    # Prüfe ob Zertifikat existiert
    if ! security find-certificate -c "MOST Zeitmanagement" >/dev/null 2>&1; then
        echo "📝 Erstelle neues Zertifikat..."
        create_certificate
    else
        echo "✅ Zertifikat bereits vorhanden"
    fi

    sign_app
}

# Führe aus
main
