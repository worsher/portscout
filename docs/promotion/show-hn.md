# Show HN draft

> Post with the GitHub repository URL. Stay available for the first two hours to answer technical questions.

## Title

Show HN: PortMarshal – An ownership and kill guard for dev servers started by coding agents

## Text

Running Claude Code, Cursor, and other coding agents in parallel on one machine
kept producing the same three problems: frameworks silently drifting to a new
port, dev servers surviving after their session exited, and one agent killing a
service another agent was actively debugging.

PortMarshal is a small CLI that treats this as an ownership and policy problem.
It scans visible TCP listeners without requiring them to be launched through the
tool, then maps port → PID → project directory → launching agent through parent-
chain analysis. launchd and systemd metadata keep managed services distinct from
processes that merely detached from their original session.

Cooperative agents can request a sticky port claim with:

    PORT=$(portmarshal claim web --prefer 3000)

Before reusing a claim, PortMarshal confirms the port is still free or still
belongs to the same project. `portmarshal stop` applies a three-tier guard:
services owned by the caller and reviewed detached services can be stopped,
while another active service is blocked with attribution and exit code 3 unless
the user explicitly supplies `--force`.

The scanner is intentionally honest about its limits: Linux listeners without
visible PID metadata are omitted, and `detached` is a review signal rather than
a claim that a process is definitely abandoned.

TypeScript, zero runtime dependencies, macOS and Linux, JSON output, semantic
exit codes, SwiftBar integration, and an npm package published with provenance.
MIT.

https://github.com/worsher/portmarshal
