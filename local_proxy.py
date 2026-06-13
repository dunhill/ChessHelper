from flask import Flask, request, Response, jsonify
import requests
import os

app = Flask(__name__)


@app.route('/proxy')
def proxy():
    url = request.args.get('url')
    if not url:
        return jsonify({'error': 'missing url parameter'}), 400

    try:
        # Perform server-side fetch to avoid browser CORS restrictions
        resp = requests.get(url, timeout=20, headers={'User-Agent': 'ChessHelper-Proxy/1.0'})
    except requests.RequestException as e:
        return jsonify({'error': 'fetch_failed', 'details': str(e)}), 502

    # Relay response body and set permissive CORS headers for browser clients
    headers = {}
    content_type = resp.headers.get('Content-Type')
    if content_type:
        headers['Content-Type'] = content_type
    headers['Access-Control-Allow-Origin'] = '*'
    headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS'
    headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'

    return Response(resp.content, status=resp.status_code, headers=headers)


@app.route('/health')
def health():
    return 'ok'


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '5000'))
    app.run(host='0.0.0.0', port=port)
