#!/usr/bin/env python3

import subprocess

# Compile the binaries
subprocess.run('make', check=True)

EXPORTS = [
    {'path': 'ssudo',   'content_type': 'application/octet-stream'}
]
