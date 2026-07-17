# Contributing to PortMarshal

Thanks for helping make local multi-agent development safer. Bug reports, attribution examples, documentation improvements, and focused code changes are all welcome.

## Before you start

- Search existing issues before opening a new one.
- Use the dedicated **Agent attribution error** template when a listener is assigned to the wrong project, agent, or service manager.
- Open an issue before a large behavioral change so the approach can be agreed on first.
- Never paste secrets or private command arguments. Redact usernames and sensitive path segments when they are not needed to reproduce the problem.

## Development setup

PortMarshal requires Node.js 18.17 or newer and pnpm 10.

```bash
git clone https://github.com/worsher/portmarshal.git
cd portmarshal
pnpm install
pnpm build
```

Run the full local checks before submitting a pull request:

```bash
pnpm test
pnpm smoke
pnpm build
```

The smoke test opens a real local listener. Changes to process discovery, attribution, signal handling, or service-manager detection should be tested on the affected operating system. GitHub Actions runs the suite on both macOS and Linux.

## Pull requests

Keep each pull request focused and include:

- The problem being solved and why it matters.
- The behavior before and after the change.
- Tests for new or corrected behavior.
- The operating systems used for manual verification, when platform behavior is involved.
- Documentation updates for user-visible commands or output.

Avoid unrelated formatting or generated-file changes. A maintainer may ask for a smaller reproduction or an additional platform fixture before merging attribution changes.

## Reporting attribution errors

The most useful reports include:

- `portmarshal --version`
- Operating system and version
- Node.js version
- The relevant `portmarshal whois <port> --json` output
- The command used to start the listener
- What PortMarshal reported and what ownership you expected

Please minimize the reproduction and redact private paths or arguments while preserving the parent-process and service-manager details needed to diagnose the issue.

By contributing, you agree that your contributions are licensed under the project's [MIT License](LICENSE).
