import urllib.request, json

try:
    d = json.loads(urllib.request.urlopen('http://127.0.0.1:8765/api/token-usage', timeout=5).read().decode()).get('models', [])
    print('\nBudgeted Providers:')
    for m in d:
        if m.get('provider', '').startswith(('freellmp', 'llmbuffet')):
            print(f"  {m.get('key')}: used={m.get('used')}, limit={m.get('limit')}")
except Exception as e:
    print(f"Failed to fetch token usage: {e}")

