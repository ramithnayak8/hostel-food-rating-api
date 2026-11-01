#!/bin/sh
# Create the lab SSH key pair once, in the volume shared with the app server, then run the command.
set -eu

if [ ! -f /keys/id_ed25519 ]; then
    ssh-keygen -q -t ed25519 -N '' -C ansible-control-node -f /keys/id_ed25519
    cp /keys/id_ed25519.pub /keys/authorized_keys
    chmod 0644 /keys/authorized_keys
    echo "entrypoint: generated SSH key pair in /keys"
fi

exec "$@"
