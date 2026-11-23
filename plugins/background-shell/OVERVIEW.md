# Background shell

Moves the shell commands an agent's turn is waiting on to the background, like Ctrl+B in Claude Code.
The commands keep running, the waiting tool calls return at once, and the turn goes on;
the commands then show among the agent's background work, where they can be stopped.

While a Claude or OpenCode agent's turn waits on a shell command or a subagent, a Background pill sits above its composer;
it goes once nothing is left to move.
The same action is in the Command Center and behind `/bg`.
Claude backgrounds its foreground Bash commands and subagents; OpenCode its blocking tools.
Other providers, Codex among them, have no way to do this yet, so their agents get no pill.

Paseo has no request for this yet, so it needs a daemon carrying the `foreground-background` patch from this plugin's repository.
On an unpatched daemon the pill answers "Background work is no longer available to stop".
Needs Paseo 0.16 or later.
The patch tracks the Paseo release this repository's flake pins, 0.17.3 now;
an older daemon needs the patch from an older commit.
