from flask import Flask, request, Response, jsonify
import requests
import os
from urllib.parse import urlparse

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


@app.route('/rendered-top-players')
def rendered_top_players():
    url = request.args.get('url', '')
    parsed_url = urlparse(url)
    if (
        parsed_url.scheme != 'https'
        or parsed_url.netloc != 'www.schachbund.de'
        or not parsed_url.path.startswith('/dwz-verbaende/')
        or not parsed_url.path.endswith('.html')
    ):
        response = jsonify({
            'error': 'invalid_url',
            'details': 'Only schachbund.de DWZ association pages are supported.'
        })
        response.status_code = 400
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response

    try:
        from playwright.sync_api import Error as PlaywrightError, sync_playwright
    except ImportError:
        response = jsonify({
            'error': 'playwright_not_installed',
            'details': 'Install Playwright and Chromium: pip install playwright && python -m playwright install chromium'
        })
        response.status_code = 503
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                page = browser.new_page()
                page.goto(url, wait_until='domcontentloaded', timeout=45000)
                page.wait_for_selector('div.table_responsiv table', timeout=30000)
                names = page.locator('div.table_responsiv table td.col_2').all_text_contents()
                names = [name.strip() for name in names if name.strip()]
                if not names:
                    response = jsonify({
                        'error': 'no_names',
                        'details': 'The rendered table contained no player names.'
                    })
                    response.status_code = 502
                else:
                    response = jsonify({'names': names})
                response.headers['Access-Control-Allow-Origin'] = '*'
                return response
            finally:
                browser.close()
    except PlaywrightError as error:
        response = jsonify({'error': 'render_failed', 'details': str(error)})
        response.status_code = 502
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response


@app.route('/health')
def health():
    return 'ok'


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '5000'))
    app.run(host='0.0.0.0', port=port)
