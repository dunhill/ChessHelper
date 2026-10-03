from flask import Flask, request, Response, jsonify
import requests
import os
import re
from urllib.parse import urlparse

app = Flask(__name__)
PLAYER_PROFILE_DIR = os.environ.get(
    'CHESSHELPER_PLAYWRIGHT_PROFILE',
    os.path.join(os.path.expanduser('~'), '.chesshelper-playwright')
)


def valid_player_id(player_id):
    return re.fullmatch(r'NU\d+', player_id or '') is not None


def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    return response


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


@app.route('/dwz-login')
def dwz_login():
    player_id = request.args.get('pkz', 'NU4174736').strip()
    if not valid_player_id(player_id):
        return 'Invalid player ID. Expected NU followed by digits.', 400

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return 'Install Playwright and Chromium before signing in.', 503

    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(
            PLAYER_PROFILE_DIR,
            headless=False
        )
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(f'https://www.schachbund.de/dwz-spieler/{player_id}.html', timeout=45000)
        page.wait_for_event('close')
        context.close()

    return 'Browser closed. The local DWZ session has been saved.'


@app.route('/rendered-player')
def rendered_player():
    player_id = request.args.get('pkz', '').strip()
    if not valid_player_id(player_id):
        return add_cors_headers(jsonify({
            'error': 'invalid_player_id',
            'details': 'Player ID must use the NU followed by digits format.'
        })), 400

    try:
        from playwright.sync_api import Error as PlaywrightError, sync_playwright
    except ImportError:
        return add_cors_headers(jsonify({
            'error': 'playwright_not_installed',
            'details': 'Install Playwright and Chromium: pip install playwright && python -m playwright install chromium'
        })), 503

    try:
        with sync_playwright() as playwright:
            context = playwright.chromium.launch_persistent_context(
                PLAYER_PROFILE_DIR,
                headless=True
            )
            try:
                page = context.pages[0] if context.pages else context.new_page()
                page.goto(
                    f'https://www.schachbund.de/dwz-spieler/{player_id}.html',
                    wait_until='domcontentloaded',
                    timeout=45000
                )
                try:
                    page.wait_for_function(
                        "() => document.querySelector('div.table_responsiv table') || (document.body && document.body.innerText.includes('Sie müssen angemeldet sein'))",
                        timeout=20000
                    )
                except PlaywrightError:
                    pass
                body_text = page.locator('body').inner_text()
                if 'Sie müssen angemeldet sein' in body_text:
                    return add_cors_headers(jsonify({
                        'error': 'authentication_required',
                        'details': 'The DWZ site hides player details until you sign in. Open http://localhost:5000/dwz-login once, sign in, then close that browser window.'
                    })), 401

                tables = page.locator('div.table_responsiv table').evaluate_all(
                    "tables => tables.map(table => Array.from(table.querySelectorAll('tr')).map(row => Array.from(row.querySelectorAll('th, td')).map(cell => (cell.innerText || '').trim())))"
                )
                tables = [table for table in tables if table]
                if not tables:
                    return add_cors_headers(jsonify({
                        'error': 'tournament_table_not_found',
                        'details': 'The signed-in player page did not contain a div.table_responsiv table.'
                    })), 502

                title = page.title()
                player_name = title
                if title.startswith('DWZ-Karteikarte '):
                    player_name = title[len('DWZ-Karteikarte '):].split(' - Deutscher Schachbund')[0].strip()

                return add_cors_headers(jsonify({
                    'playerId': player_id,
                    'playerName': player_name,
                    'tables': tables,
                    'pageText': body_text
                }))
            finally:
                context.close()
    except PlaywrightError as error:
        return add_cors_headers(jsonify({
            'error': 'render_failed',
            'details': str(error)
        })), 502


@app.route('/health')
def health():
    return 'ok'


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '5000'))
    app.run(host='127.0.0.1', port=port)
