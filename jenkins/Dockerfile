# Local Jenkins for this project: the LTS controller (JDK 17) plus what the Jenkinsfile needs.
#   - Python 3.12 (via uv's standalone builds) to install, lint, test and package the app.
#     3.12 matches the Docker image and Ubuntu 24.04, so the .pyz it builds runs on both.
#   - The Docker CLI + buildx, talking to the host's daemon through the mounted socket,
#     to build the versioned application image.
#   - Plugins from plugins.txt; the job and admin user come from casc.yaml (Configuration as Code).
# The `lts-jdk17` tag tracks the current LTS so the latest plugin releases stay compatible.
FROM jenkins/jenkins:lts-jdk17

USER root

COPY --from=ghcr.io/astral-sh/uv:0.8.0 /uv /usr/local/bin/uv
COPY --from=docker:27.5.1-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker:27.5.1-cli /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx

# Expose the whole install under a stable path (not just the binary), so venvs created from it
# can find the standard library.
ENV UV_PYTHON_INSTALL_DIR=/opt/python \
    PATH=/opt/python/3.12/bin:$PATH
RUN uv python install 3.12 \
 && ln -s "$(dirname "$(dirname "$(uv python find 3.12)")")" /opt/python/3.12 \
 && python3.12 -m venv /tmp/venv-check \
 && /tmp/venv-check/bin/pip --version \
 && rm -rf /tmp/venv-check

USER jenkins

COPY --chown=jenkins:jenkins plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt
