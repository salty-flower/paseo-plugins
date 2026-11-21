# Later

`/later` sends a prompt to the current agent at a set time.

Type `/later 10m <prompt>` for a delay, or `/later [YYYY-MM-DD] HH:mm[:ss] <prompt>` for a local wall-clock time.
When the time comes, the prompt steers a running turn, or starts a turn if the agent is idle.
`/later list` shows this agent's pending prompts and `/later cancel <id|all>` removes them.
While prompts are pending, a `Later` pill in the composer lists them with a countdown and a Cancel button each.
It works with every provider.

Pending prompts are stored in `~/.paseo/plugin-data/later/jobs.json` on the daemon machine, so they survive a daemon restart.
After a restart, a prompt that fell due goes out once an app connects or an agent runs a turn.

Needs Paseo 0.16 or later, on the daemon and on the app.
