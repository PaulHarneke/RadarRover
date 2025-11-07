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
