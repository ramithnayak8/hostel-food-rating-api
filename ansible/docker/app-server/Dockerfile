# The managed host: a bare Ubuntu 24.04 "server" with systemd and SSH, and no Python.
# The playbook installs the runtime, deploys the .pyz artifact and runs it as a systemd service.
# SSH accepts the control node's key from the shared /keys volume (see ../control-node).
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends systemd systemd-sysv openssh-server sudo \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --shell /bin/bash ansible \
 && echo 'ansible ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/ansible \
 && chmod 0440 /etc/sudoers.d/ansible \
 && printf 'AuthorizedKeysFile /keys/authorized_keys\nPasswordAuthentication no\nPermitRootLogin no\n' \
      > /etc/ssh/sshd_config.d/lab.conf \
 && systemctl enable ssh \
 && systemctl mask getty.target systemd-logind.service

STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
