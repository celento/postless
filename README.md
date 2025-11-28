# postless

A fast, keyboard-driven HTTP client for the terminal. Requests are plain YAML files that live in your repo, environments are just variables, and everything works over SSH. No account, no cloud, no Electron.

```sh
npx postless
```

![status](https://img.shields.io/badge/status-beta-orange) ![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen) ![license](https://img.shields.io/badge/license-MIT-blue)

## Why

Postman-style clients are heavy GUI apps with login walls. curl is fast but has no saved requests and no readable response view. postless sits in between: a two-pane TUI in the spirit of lazygit, with saved requests as YAML files you can commit, diff, and share through git like any other code.

## Features

- HTTP/1.1 and HTTP/2 via undici (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)
- Saved request collections as one YAML file per request
- Named environments with `{{variable}}` substitution and OS env passthrough for secrets
- Response viewer with JSON syntax highlighting, folding, in-body search, and diffing against the previous response
- Per-project history and per-environment cookie jar, stored outside the repo
- curl import and export, Postman v2.1 collection import
- Headless CLI mode for scripts and CI
- Configurable keybindings

## Install

```sh
npm install -g postless   # or just: npx postless
```

Requires Node.js 20 or newer.

## Quick start

Create `.postless/auth/login.yaml` in your project:

```yaml
type: http
method: POST
url: "{{base_url}}/v1/login"
headers:
  content-type: application/json
body: |
  {"email": "{{email}}", "password": "{{password}}"}
```

Define environments in `.postless/environments.yaml`. A value beginning with `$` is read from an OS environment variable when the request fires, so secrets never land in git:

```yaml
default: local
environments:
  local:
    base_url: http://localhost:3000
    email: dev@example.com
    password: $DEV_PASSWORD
  prod:
    base_url: https://api.example.com
    password: $PROD_PASSWORD
```

Then run `postless` and press enter on a request to fire it. A missing variable blocks the send and tells you which one.

## Headless mode

```sh
postless fire auth/login --env prod
```

Prints the response body to stdout and exits nonzero on network errors and HTTP 4xx/5xx, so it slots into shell pipelines and CI checks.

## Keybindings

| Key | Action |
| --- | --- |
| `enter` | fire the selected request |
| `j/k` or arrows | navigate / scroll |
| `h/l` | collapse / expand folders |
| `tab` | switch panes |
| `/` | fuzzy search requests, or find in the response body |
| `n/N` | next / previous match in the body |
| `n` (tree) | new request |
| `e` / `E` | edit in-app / open the YAML in `$EDITOR` |
| `y` / `Y` | copy response body / copy as curl |
| `p` | paste a curl command as a new request |
| `H` | toggle response headers |
| `D` | diff against the previous response |
| `f` | fold the JSON node under the cursor |
| `ctrl+e` | cycle environments |
| `v` | environments and cookie jar |
| `a` / `R` / `m` / `d` | folder / rename / move / delete (with confirm) |
| `?` | full keymap, including your overrides |

Override any binding in `~/.config/postless/config.yaml`.

## Importing from Postman

```sh
postless import collection.json
```

Converts a Postman v2.1 collection into `.postless/` files: folders, requests, headers, common auth and body types, and collection variables. Scripts and tests are reported as skipped rather than silently dropped.

## Data locations

| What | Where |
| --- | --- |
| Requests | `.postless/` in your project (commit it) |
| History (last 200 per project) | OS data dir, never the repo |
| Cookies (per environment) | alongside history |
| Config and keybindings | `~/.config/postless/config.yaml` (`%APPDATA%\postless` on Windows) |

## Development

```sh
npm install
npm test        # vitest
npm run dev     # run the TUI from source
npm run build   # bundle with tsup
```

Contributions are welcome. Open an issue first for anything bigger than a bugfix.

## License

MIT
