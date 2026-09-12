# DeckRemote agent setup

## What changed

This package separates two different concepts:

1. `AGENTS.md` + `agents/*.md` describe project rules and role responsibilities.
2. `.codex/agents/*.toml` tells Codex which model/reasoning profile to use for
   each custom subagent.

That separation is important: writing "use a smarter model" only in an agent
Markdown file is guidance, while a custom agent TOML can actually set the
model and reasoning effort for that agent.

## Recommended routing

- `protocol_architect`: gpt-5.6 / high
- `security_reviewer`: gpt-5.6 / high
- `integration_reviewer`: gpt-5.6 / high
- `pc_implementer`: gpt-5.6 / high
- `mobile_implementer`: gpt-5.6 / high
- `qa_engineer`: gpt-5.6-terra / high
- `repo_explorer`: gpt-5.6-terra / medium
- `docs_researcher`: gpt-5.6-terra / medium
- `test_runner`: gpt-5.6-luna / low

The default subagent profile is intentionally Terra/medium so unclassified
work does not automatically consume the most expensive reasoning tier.

## Install into the repository

Copy these paths into the DeckRemote repository root:

```text
AGENTS.md
agents/
.codex/agents/
```

Merge the `[agents]` section from `config.toml.example` into your active Codex
configuration if you want the suggested concurrency/default-subagent settings.
Do not overwrite unrelated existing Codex settings blindly.

## Suggested first parent prompt

```text
Read AGENTS.md. Build DeckRemote according to the phased workflow.
First use protocol_architect to create and validate the shared protocol.
Only after the protocol is locked, run pc_implementer and mobile_implementer in
parallel within their file scopes. Then use qa_engineer and security_reviewer.
Finally use integration_reviewer and do not declare the MVP complete unless the
Definition of Done is satisfied.
```

## Important

Model names and supported reasoning levels are Codex-version/account dependent.
The profiles here use the currently documented gpt-5.6 / gpt-5.6-terra /
gpt-5.6-luna routing model. If Codex reports that a selected reasoning effort is
unsupported for a model, lower that agent's effort rather than removing the
role separation.
