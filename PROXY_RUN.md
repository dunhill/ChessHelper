Running the local Flask proxy

1. Install dependencies (use a virtualenv if you prefer):

```bash
pip install flask requests playwright
python -m playwright install chromium
```

2. Start the local-only proxy (binds to 127.0.0.1:5000 by default):

```bash
python local_proxy.py
```

3. Serve the site folder over HTTP so the page has a non-null origin:

```bash
python -m http.server 8000
```

4. Open the page in your browser:

http://localhost:8000/dwzCompare.html

If player history returns an authentication-required message, open
`http://localhost:5000/dwz-login?pkz=NU4174736`, sign in to the DWZ site in the
Chromium window, then close that window. The local renderer saves this session
in your user profile directory and reuses it for player pages.

Notes:
- The proxy exposes `/proxy?url=<encoded_url>` and returns the upstream response
  with `Access-Control-Allow-Origin: *` so the browser can fetch it.
- Top-player lookup falls back to `/rendered-top-players?url=<encoded_url>` when
  the raw response contains only the JavaScript loading shell. This endpoint
  uses headless Chromium to run the page and extract player names.
- The rendered endpoint accepts only HTTPS pages on `www.schachbund.de` under
  `/dwz-verbaende/`.
- Player details are fetched from `/dwz-spieler/NU....html` by the local
  `/rendered-player` endpoint. The DWZ site requires authentication to expose
  the tournament history; the one-time login uses a separate local Chromium
  profile at `~/.chesshelper-playwright` (override with
  `CHESSHELPER_PLAYWRIGHT_PROFILE`).
- You can change the port by setting `PORT` environment variable before starting.
