# Phoenix Predictions (Backend)

Node.js + Express backend proxy (required for secure API keys).

## Endpoints
- `GET /health`
- `GET /today`

`/today` returns JSON:

- `serverDate` (Morocco date)
- `serverTime` (ISO)
- `timeZone` (Africa/Casablanca)
- `leagues[]` grouped by league

## Environment Variables (set later in Render)
- `API_FOOTBALL_KEY` (required for global fixtures)
- `FOOTBALL_DATA_KEY` (optional)
- `TZ` = `Africa/Casablanca`

## Local run (optional)
```bash
npm install
npm start
```

If `API_FOOTBALL_KEY` is not set, `/today` returns demo payload.
