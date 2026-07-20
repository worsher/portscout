# Show HN submission kit

> HN asks people not to post generated or AI-edited comments. Treat the notes
> below as a fact check, then write the first comment yourself in your own
> voice. Do not paste this file as the comment.

## Submission fields

- **Title:** `Show HN: PortMarshal – Guard dev servers from cross-agent stops`
- **URL:** `https://github.com/worsher/portmarshal`
- **Text field:** leave empty

The title is under HN's 80-character submission limit. Submit the repository as
the URL, then add a normal first comment; a text-only submission would make the
project harder to try.

## Facts for the first comment

Use only the points that matter to your own story:

- You built PortMarshal after parallel coding-agent sessions repeatedly caused
  silent port drift, detached dev servers, and one session stopping another
  session's active service.
- It scans existing TCP listeners; a process does not have to be launched
  through PortMarshal first.
- Attribution follows port → PID → project directory → process parent chain for
  Claude Code, Cursor, and terminal apps, then enriches managed services from
  Docker/Compose, PM2, launchd, and systemd metadata.
- Shared Docker Desktop listeners are split by container and Compose service;
  PM2 listeners are shown as `pm2:<app-name>` with the configured application
  cwd. Full PM2 environment variables are not retained.
- `portmarshal stop` blocks a service attributed to another active project by
  default. The explicit `--force` flag is the escape hatch.
- Attributed managed targets are stopped with `docker stop` or `pm2 stop`, not
  by signaling the shared Docker backend or a supervised PM2 child.
- Cooperative agents can use
  `PORT=$(portmarshal claim web --prefer 3000)` for a sticky claim.
- A claim is not an OS socket reservation. PortMarshal revalidates it before
  reuse, but there is still a handoff window before the app binds the port.
- `detached` means the process left its original session; it does not prove that
  the process is abandoned.
- Linux listeners without visible PID metadata are omitted instead of guessed.
- It is an MIT-licensed TypeScript CLI for macOS and Linux, has zero runtime npm
  dependencies, JSON output, semantic exit codes, and an optional SwiftBar view.
- The CLI makes no network or telemetry requests while running.

## Useful technical details to explain

- Why process ancestry alone is insufficient after reparenting, and why
  launchd/systemd labels are checked separately.
- Why a shared runtime PID is not enough for Docker Desktop or PM2, and why
  their manager metadata and control commands are used instead.
- Why PortMarshal composes OS inspection with an ownership policy instead of
  replacing `lsof` or `ss`.
- Why a cooperative claim cannot close the allocation-to-bind race without
  becoming the socket owner or a proxy.
- Why the default guard is intentionally bypassable after the user reviews the
  attribution.

## Feedback worth asking for

- Linux distributions or process layouts where attribution is incomplete.
- Coding agents or terminal environments that need a source signature.
- Whether detached services should require a stricter default confirmation.
- Real multi-agent workflows where a lease or proxy model would be preferable.

## Posting rules

- Post only when you can personally answer questions for the next two hours.
- Do not ask anyone to upvote, comment, or submit the project.
- Do not delete and repost if the first submission is quiet.
- Answer limitations directly; do not turn the thread into a feature list.
