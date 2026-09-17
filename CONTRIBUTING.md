# Contributing

Thank you for helping improve `vuln-screenshot`.

## Before opening an issue

- Search existing issues first.
- Use GitHub's private vulnerability reporting for security issues; do not publish exploit details or secrets in a public issue.
- Remove credentials, cookies, internal hostnames, home-directory paths, and customer data from screenshots and logs.

## Development setup

```bash
git clone https://github.com/jweny/vuln-screenshot.git
cd vuln-screenshot
npm ci
npm run install-browser
```

Node.js 20 or newer is required. The supported development platforms are macOS and Linux.

## Validate a change

```bash
npm run check
npm test
npm run build
npm pack --dry-run
```

Tests must use local fixtures or synthetic content. Do not commit generated `artifacts/`, real vulnerability evidence, or captured credentials.

## Pull requests

- Keep each pull request focused on one problem.
- Explain the behavior change and how it was verified.
- Add or update tests for behavior changes.
- Update the README or files under `docs/` when a public interface changes.
- Preserve raw-byte semantics: do not silently normalize requests or terminal output.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
