# hostel_food_app

Created with `ansible-galaxy init hostel_food_app`. Deploys the Hostel Food Rating API to an Ubuntu host:

1. Installs the Python 3 runtime (`apt`).
2. Creates a `hostelfood` system user and `/opt/hostel-food`, `/etc/hostel-food`, `/var/lib/hostel-food`.
3. Copies the build artifact, `dist/hostel-food-api-*.pyz` (one executable file holding the app and its dependencies).
4. Generates a JWT secret on the server once, and writes an environment file (SQLite database in `/var/lib/hostel-food`).
5. Installs and starts the `hostel-food-api` systemd service, then waits for `/health/ready`.

Copying a new artifact, changing the environment file or changing the unit **notifies the `Restart hostel-food-api` handler**. Unit changes also notify `Reload systemd`. A re-run with nothing changed restarts nothing.

## Variables

| Variable | Default | Meaning |
|---|---|---|
| `app_port` | `8000` | Port the API listens on |
| `app_bind_address` | `0.0.0.0` | Interface to bind |
| `app_artifact` | newest `dist/hostel-food-api-*.pyz` | Artifact to deploy |
| `app_user` | `hostelfood` | Service account |
| `app_home` / `app_config_dir` / `app_data_dir` | `/opt/hostel-food` / `/etc/hostel-food` / `/var/lib/hostel-food` | Install, config and data paths |
| `app_env`, `app_log_level`, `app_docs_enabled` | `production`, `INFO`, `true` | App settings |

## Example

```yaml
- hosts: app_servers
  become: true
  roles:
    - role: hostel_food_app
      vars:
        app_port: 8000
```
