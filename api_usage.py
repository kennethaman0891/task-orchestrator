import urllib.request,json
d=json.loads(urllib.request.urlopen('http://127.0.0.1:8765/api/token-usage').read().decode())['models']
print('\nBudgeted Providers:')
for m in d: if m['provider'].startswith(('freellmp','llmbuffet'))): print(f'  {m["key"]}: used=, limit='
