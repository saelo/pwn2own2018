#!/usr/bin/env python3

import subprocess

# Compile the binaries
subprocess.run('make', check=True)

EXPORTS = [
    {'path': 'kextloader',  'content_type': 'application/octet-stream'},
    {'path': 'khax.zip',    'content_type': 'application/octet-stream'}
]
