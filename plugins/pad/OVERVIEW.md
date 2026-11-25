# Pad

Pad gives each top-level agent a board beside its chat, drawn with Generative UI, so you read one place instead of scrolling its replies.
It is meant for an agent that coordinates other agents while you are away.

The agent writes the pad with one tool, `pad`.
Each call replaces one named section with a ```ui spec, such as one section per workstream and one for what waits on you.
The spec is checked before it is saved; a spec that does not compile is refused and the pad keeps the previous version.
Agents started by another agent do not get the tool,
except a handoff: an agent titled `[Handoff] …`, as Paseo's handoff skill names it, takes over the router's job and gets it.

The **Pad** pill in the agent's composer shows its pad as a popover.
The `/pad` command, the Command Center and the workspace's panel list open a panel with the pad of every agent in that workspace.
Buttons in the pad send their text to that agent, prefixed with `[pad: <section>]`.
Tap a section's binding chip to edit its workspace, external reference, or display label.
Your correction survives later agent writes to that section.
**✕** beside a section deletes that section; **Clear** deletes the whole pad.

Pads are stored as JSON under `plugin-data/pad/` in the Paseo home on the daemon machine and survive restarts.
The panel and the pills refresh every few seconds rather than instantly.
Section ages also refresh when you come back to the pad: window focus, switching back to its tab, or moving the pointer over it.
On Unix, time trackers, analytics, and automation can subscribe to a local socket under the Paseo home for section bindings, views, and button presses.

The pad carries its own copy of the Generative UI renderer, so it works with or without the Generative UI plugin installed.
Needs Paseo 0.15 or later.
