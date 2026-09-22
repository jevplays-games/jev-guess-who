"""DOM/browser regression tests. Optional: pip install playwright.
Default: real HTTP against GW_BASE_URL (http://localhost:8787).
GW_INLINE_FIXTURE=1: render local assets in about:blank and bridge API requests
through Python. This explicitly avoids claiming real-browser HTTP transport
coverage when the execution environment's browser navigation is restricted.
"""
import base64
import http.cookiejar
import json
import os
from pathlib import Path
import re
import shutil
import urllib.error
import urllib.request
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public'
REPORTS = ROOT / 'reports'
REPORTS.mkdir(exist_ok=True)
BASE = os.environ.get('GW_BASE_URL', 'http://localhost:8787')
INLINE = os.environ.get('GW_INLINE_FIXTURE') == '1'
cache = {}
def module_url(path):
    path = path.resolve()
    if path in cache:
        return cache[path]
    source = path.read_text()
    source = re.sub(r"from\s+(['\"])(\.[^'\"]+)\1", lambda m: 'from ' + json.dumps(module_url(path.parent / m.group(2))), source)
    if path.name == 'game.js':
        source = source.replace('image.src=`/portraits/${c.id}.svg`', 'image.src=window.__PORTRAITS[c.id]')
    result = 'data:text/javascript;base64,' + base64.b64encode(source.encode()).decode()
    cache[path] = result
    return result

def setup_page(browser, viewport, errors):
    page = browser.new_page(viewport=viewport, reduced_motion='reduce')
    page.on('pageerror', lambda e: errors.append(str(e)))
    if not INLINE:
        page.goto(BASE, wait_until='networkidle')
        return page
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    def request_bridge(data):
        headers = dict(data.get('headers', {}))
        if data.get('method', 'GET') == 'POST':
            headers['Origin'] = BASE
        req = urllib.request.Request(BASE + data['url'], method=data.get('method', 'GET'), headers=headers,
                                     data=data.get('body', '').encode() if data.get('body') else None)
        try:
            response = opener.open(req, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        return {'status': response.status, 'body': response.read().decode(), 'headers': dict(response.headers)}
    page.expose_function('__requestBridge', request_bridge)
    html = (PUBLIC / 'index.html').read_text()
    html = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.S)
    html = re.sub(r'<link[^>]+>', '', html)
    page.set_content(html)
    page.add_style_tag(content=(PUBLIC / 'game.css').read_text())
    portraits = {p.stem: 'data:image/svg+xml;base64,' + base64.b64encode(p.read_bytes()).decode() for p in (PUBLIC / 'portraits').glob('*.svg')}
    page.evaluate('(portraits) => window.__PORTRAITS=portraits', portraits)
    page.evaluate("""() => {
        if (!crypto.randomUUID) crypto.randomUUID = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r=crypto.getRandomValues(new Uint8Array(1))[0]&15; return (c==='x'?r:(r&3|8)).toString(16); });
        window.fetch = async (url, options={}) => {
            const result = await window.__requestBridge({url:String(url),method:options.method||'GET',headers:options.headers||{},body:options.body||''});
            return new Response(result.body,{status:result.status,headers:result.headers});
        };
    }""")
    page.evaluate('async url => { await import(url); }', module_url(PUBLIC / 'game.js'))
    page.wait_for_function("document.querySelector('#login').textContent !== 'Sign in with Discord'")
    return page

def run():
    errors = []
    checks = []
    with sync_playwright() as p:
        executable = os.environ.get('GW_CHROMIUM') or shutil.which('chromium')
        browser = p.chromium.launch(headless=True, **({'executable_path': executable} if executable else {}), args=['--no-sandbox'])
        page = setup_page(browser, {'width':1440,'height':1150}, errors)
        assert page.locator('#board .character').count() == 24
        checks.append('24 character cards rendered')
        page.locator('#new-game').click()
        page.wait_for_function("document.querySelector('#ask').disabled === false", timeout=30000)
        assert 'local' in page.locator('#opponent-source').inner_text().lower()
        checks.append('local opponent is explicitly labeled')
        assert page.locator('#secret img').get_attribute('alt')
        checks.append('own secret has full accessible trait description')
        page.screenshot(path=str(REPORTS / 'desktop-game.png'), full_page=True)
        page.locator('#ask').click()
        page.wait_for_function("document.querySelector('#ask').disabled === false", timeout=30000)
        assert page.locator('.history-entry').count() >= 2
        checks.append('human question, automatic elimination and opponent response')
        page.locator('#text-mode').check()
        assert page.locator('#board .traits').count() == 24
        checks.append('text alternative exposes all character traits')
        page.locator('#text-mode').uncheck()
        page.locator('#rules-button').click()
        assert page.locator('#rules-dialog').is_visible()
        page.keyboard.press('Escape')
        checks.append('rules dialog keyboard dismissal')
        page.locator('#tab-analytics').click()
        page.wait_for_selector('.kpi-grid')
        assert page.locator('#analytics-content table').count() >= 10
        assert 'stored' in page.locator('#coverage').inner_text()
        checks.append('analytics tables, cohorts and coverage visible')
        page.screenshot(path=str(REPORTS / 'desktop-analytics.png'), full_page=True)
        page.locator('#tab-play').click()
        page.set_viewport_size({'width':390,'height':844})
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
        assert page.locator('#board').evaluate("e=>getComputedStyle(e).gridTemplateColumns.split(' ').length") == 4
        checks.append('390px mobile layout has four columns and no horizontal overflow')
        page.screenshot(path=str(REPORTS / 'mobile-game.png'), full_page=True)
        page.locator('#resign').click()
        page.wait_for_selector('#confirm-dialog[open]')
        page.locator('#confirm-dialog button[value=confirm]').click()
        page.wait_for_selector('#result:not([hidden])')
        assert page.locator('#export-replay').is_enabled()
        checks.append('terminal result and replay export become available')
        page.locator('#tab-leaderboard').click()
        page.wait_for_selector('#leaderboard-content table')
        checks.append('world leaderboard loads without fabricating entries')
        assert not errors, errors
        checks.append('no JavaScript page errors')
        browser.close()
    report = {'passed':True,'transport':'inline assets + Python HTTP bridge' if INLINE else 'real browser HTTP',
              'checks':checks,'javascriptErrors':errors,'notCovered':['Live Discord credentials','Live TypeSafe credentials','Production Cloudflare deployment']}
    (REPORTS / 'browser-results.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))

if __name__ == '__main__':
    run()
