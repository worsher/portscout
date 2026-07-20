# Launch reply bank

Use these as verified facts, not canned replies. Answer in the same language and
level of detail as the question.

## Why not just use `lsof` or `ss`?

PortMarshal uses OS-level inspection rather than replacing it. The added value is
project and launching-source attribution, a small cooperative registry, drift
detection, and a policy decision before termination. If raw socket/process data
is all someone needs, `lsof` or `ss` remains the simpler tool.

## How is this different from Portless or Sonar?

Portless launches apps behind stable named local URLs. Sonar is a broader
localhost and Docker manager. PortMarshal focuses on ownership between parallel
coding-agent sessions and can inspect visible services it did not launch. These
tools can coexist.

## Does `claim` reserve the port?

No. It is a cooperative lease recorded per project and service name. PortMarshal
checks both the registry and current listeners and revalidates a sticky claim
before returning it, but another process can still bind during the handoff to
the application. Closing that race requires owning the socket or proxying the
service, which PortMarshal does not currently do.

## Can it always identify the coding agent?

No. Attribution depends on process metadata visible to the current user. It
follows the parent chain and recognizes known agent, terminal, Docker, launchd,
and systemd signatures. Reparenting, containers, permission boundaries, or an
unknown launcher can reduce the result to a project, `detached`, or `?`. On
Linux, listeners without visible PID metadata are omitted rather than guessed.

## Does `detached` mean safe to kill?

No. It means the process has been reparented away from its original session and
has no recognized launchd/systemd manager in the visible chain. It could be a
leftover dev server or an intentional daemon. The label is a prompt to review
the command, project, and PID before acting.

## What does the stop guard actually block?

For a listener attributed to another active project, `portmarshal stop` prints
the attribution and returns exit code 3 instead of sending a signal. The user
can explicitly override that decision with `--force`; on macOS, `--gui` can ask
through a confirmation dialog. OS permissions still apply.

## Does it send process data anywhere?

No. The CLI source contains no HTTP client, analytics, or telemetry path. It
reads local socket/process metadata and a registry under `~/.portmarshal`.

## Why macOS and Linux but not Windows?

The scanner currently depends on Unix process and listener metadata: `lsof` and
`launchctl` on macOS, `ss` plus `/proc` and systemd metadata on Linux. Windows
would need a separate scanner and attribution model rather than a platform flag.

## What privileges does it need?

It runs as the current user and does not require a daemon or root for its normal
workflow. That also means it cannot see or stop processes hidden by OS
permissions. Running with elevated privileges changes the visible and killable
process set and should not be the default.

## Is there telemetry or a background service?

No. Commands run on demand. `watch` refreshes in the foreground, and the
optional SwiftBar integration periodically invokes the CLI. There is no bundled
background daemon and no runtime network request.

## What feedback is most useful?

- The OS and version.
- The exact PortMarshal command and output, preferably `--json` where supported.
- The listener's real launcher and project.
- What PortMarshal reported instead.
- Whether tmux, Docker, launchd, systemd, an IDE, or a remote shell was involved.
- A minimized command that reproduces the attribution or guard error.

Use the repository's **Agent attribution error** issue form for repeatable
misclassification. Remove secrets and private paths from commands before
posting them publicly.
