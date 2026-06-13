Running the local Flask proxy

1. Install dependencies (use a virtualenv if you prefer):

```bash
pip install flask requests
```

2. Start the proxy (binds to port 5000 by default):

```bash
python local_proxy.py
```

3. Serve the site folder over HTTP so the page has a non-null origin:

```bash
python -m http.server 8000
```

4. Open the page in your browser:

http://localhost:8000/dwzCompare.html

Notes:
- The proxy exposes `/proxy?url=<encoded_url>` and returns the upstream response
  with `Access-Control-Allow-Origin: *` so the browser can fetch it.
- You can change the port by setting `PORT` environment variable before starting.
