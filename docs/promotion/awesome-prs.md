# Awesome-list submission plan

> Re-read each target's current contribution instructions immediately before
> submitting. Submit one target at a time after PortMarshal has real users; a
> listing should be a curation request, not the launch strategy itself.

## 1. awesome-claude-code — wait

Repository: `hesreallyhim/awesome-claude-code`

The project currently says recommendations are temporarily paused. Do not open
an issue or PR until that notice is removed. When recommendations reopen:

- Use the repository's **Recommend a resource** web form.
- Do not open a PR and do not use `gh`; the repository explicitly rejects both
  routes for recommendations.
- The recommendation must be written and submitted by a human.
- Use a one-line factual description, not a sales pitch.

Facts to turn into your own description:

```text
PortMarshal is a local service ownership CLI for Claude Code and other coding
agents. It attributes visible listeners to projects and launching agents,
coordinates sticky port claims, and blocks cross-project stops by default.
```

## 2. awesome-cli-apps — first PR candidate

Repository: `agarrharr/awesome-cli-apps`

Suggested section: `Utilities → Network Utilities`. Confirm the active section
and alphabetical placement immediately before editing.

```markdown
- [PortMarshal](https://github.com/worsher/portmarshal) - Attribute local dev-server ports to projects and coding agents, coordinate sticky claims, and guard cross-project stops.
```

Keep the PR to one README entry. In the PR body, disclose that you maintain the
project and explain why it belongs in that section.

## 3. awesome-mac — second PR candidate

Repository: `jaywcjlove/awesome-mac`

Suggested section: `Developer Tools → Developer Utilities`. It may also fit
`Utilities → Menu Bar Tools`, but the core product is a CLI and the SwiftBar view
is optional, so Developer Utilities is the more accurate primary category.

```markdown
* [PortMarshal](https://github.com/worsher/portmarshal) - Attribute local dev listeners to their project and launching agent; includes guarded stop, sticky port claims, and an optional SwiftBar view. [![Open-Source Software][OSS Icon]](https://github.com/worsher/portmarshal) ![Freeware][Freeware Icon]
```

Follow the repository's exact icon and punctuation style when editing the live
README. Keep the PR limited to the English list unless its contribution guide
requires updating the translated list too.

## 4. SwiftBar repository — do not submit now

The old `swiftbar/swiftbar-plugins` repository is archived, and SwiftBar's
current README points repository-content questions to that archived project.
Do not prepare a PR against the previously listed `swiftbar/plugin-repository`;
that target is not current.

The local integration remains useful as a PortMarshal feature. Revisit a public
plugin submission only when SwiftBar documents an active intake path, or submit
to the upstream xbar/BitBar repository after confirming that its current rules
accept a wrapper that depends on an npm-installed CLI.

## PR body template

```markdown
## What

Adds PortMarshal, an MIT-licensed CLI for local dev-server attribution, sticky
port claims, and guarded stops in multi-agent development.

## Disclosure

I maintain this project.

## Verification

- macOS and Linux support
- installable as `portmarshal` from npm
- zero runtime npm dependencies
- repository: https://github.com/worsher/portmarshal
```

Do not reuse identical prose across several lists on the same day. Adapt the
description to the list's audience and respond to maintainer feedback before
opening the next submission.
