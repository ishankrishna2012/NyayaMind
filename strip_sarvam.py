import os

app_js_path = r"c:\Users\KILKARI\Downloads\SevenJurors (7)\SevenJurors\app.js"
with open(app_js_path, 'r', encoding='utf-8') as f:
    content = f.read()

import re

# Remove Sarvam AI functions
sarvam_funcs = ['getSarvamKey', 'setSarvamKey', 'sarvamTranslate', 'showTranslateToast', 'hideTranslateToast', 'updateSarvamNote', 'showSarvamKeyPrompt', 'saveSarvamKey', 'skipSarvam', 'updateSarvamKeyFromProfile']

for func in sarvam_funcs:
    content = re.sub(rf'async function {func}\(.*?\)\s*\{{.*?\}}', '', content, flags=re.DOTALL)
    content = re.sub(rf'function {func}\(.*?\)\s*\{{.*?\}}', '', content, flags=re.DOTALL)

# Remove Sarvam calls
content = re.sub(r'updateSarvamNote\(\);', '', content)
content = re.sub(r'const key = getSarvamKey\(\);', '', content)

with open(app_js_path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Sarvam stripped from app.js")
