# The Ansible control node (Ansible doesn't run natively on Windows): ansible-core + an SSH client.
FROM python:3.12-slim

# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssh-client \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir --root-user-action=ignore ansible-core==2.18.6

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["ansible-playbook", "-i", "inventory", "playbook.yml"]
