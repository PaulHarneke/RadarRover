# RadarRover

RadarRover stellt einen kompakten Radar-Webserver bereit, der Messwerte visualisiert und optional an Node-RED weiterleitet.

## Voraussetzungen

- Node.js 18 oder neuer (wegen nativer `fetch`-API)

## Installation & Start

```bash
npm install
npm start
```

Der Server startet standardmäßig auf Port `3000`.

### HTTPS aktivieren

Der Server kann zusätzlich per HTTPS erreichbar gemacht werden. Dazu müssen ein Zertifikat
und der zugehörige Schlüssel bereitgestellt werden:

```bash
export HTTPS_KEY_PATH=./certs/server.key
export HTTPS_CERT_PATH=./certs/server.crt
# optional: HTTPS_PASSPHRASE und HTTPS_PORT (Standard: 3443)
npm start
```

Bei fehlenden Dateien bleibt HTTPS deaktiviert.

## Frontend

- Aufruf: `http://localhost:3000/`
- Visualisierung der Referenzfläche (1210 × 810 mm) mit Tag-Position, Distanzlinie und Winkelanzeige
- Echtzeitupdates via Server-Sent Events (`/events`)

## API

### POST `/update`

Aktualisiert den Radarstatus.

```json
{
  "distance_mm": 315.4,
  "angle_deg": 42.7
}
```

Antwort: `200 OK`

```json
{
  "status": "ok",
  "state": {
    "distance_mm": 315.4,
    "angle_deg": 42.7,
    "x_mm": 233.1,
    "y_mm": 213.8,
    "ts": "2025-03-12T09:41:22.123Z"
  }
}
```

## Weiterleitung zu Node-RED

- Ziel-URL über `NODE_RED_HTTP_URL` (Standard: `http://127.0.0.1:1880/radar`)
- Retry-Cooldown konfigurierbar über `NODE_RED_RETRY_COOLDOWN_MS` (Default `10000`)
- Nachrichtenformat:

```json
{
  "distance_mm": 315.4,
  "angle_deg": 42.7,
  "x_mm": 233.1,
  "y_mm": 213.8,
  "ts": "2025-03-12T09:41:22.123Z",
  "source": "radar-ui"
}
```

Fehlversuche führen zu automatischen Retries nach Ablauf des Cooldowns.

### Node-RED Flow-Import

Der Ordner [`node-red`](node-red) enthält die exportierte Flow-Definition [`radar-flow.json`](node-red/radar-flow.json).
So importierst du sie in dein Node-RED-Projekt:

1. Öffne Node-RED und wähle rechts oben das Menü **Import** → **Clipboard**.
2. Kopiere den Inhalt der JSON-Datei in das Eingabefeld oder wähle **Select a file** und lade die Datei direkt hoch.
3. Bestätige mit **Import**. Der Flow heißt **Radar Ingress**.
4. Deploye die Änderungen. Der Flow lauscht auf `POST /radar`, validiert das eingehende Payload, speichert die letzte Messung im Flow-Kontext und beantwortet die Anfrage mit einer Quittierung.
5. Über den *link out*-Knoten **Radar snapshots broadcast** kannst du die aufbereiteten Messwerte an weitere Flows anbinden.

