# Feedback and improvements

Reporting a problem or suggesting an improvement is a contribution in its own
right. You do not need to write code or set up a development environment.

Start by searching the [existing issues](https://github.com/zackwag/caddy-ui/issues).
If someone has reported the same problem, add useful details to that thread.
Otherwise, [open a new issue](https://github.com/zackwag/caddy-ui/issues/new).

## Report a problem

Include enough information for someone else to understand and reproduce it:

- Your caddy/ui version, shown in the sidebar or at `GET /api/version`.
- The affected page or operation and the steps that trigger the problem.
- What you expected to happen and what actually happened.
- Relevant error messages, logs, or screenshots.
- Your deployment setup and, for browser issues, the browser and device you use.

Application logs are available in the log viewer. If more detail is needed,
`LOG_LEVEL=debug` enables additional backend diagnostics. Remove credentials and
other private information before sharing logs or configuration excerpts.

## Suggest an improvement

Explain the problem you want to solve, how you currently handle it, and what
behavior would help. A concrete example or screenshot makes a proposal easier
to discuss. You can suggest a solution, but a clear description of the need is
enough to start the conversation.

For larger changes, discuss the proposal in an issue before starting substantial
implementation work.

## Follow up

Keep the issue updated if you find a workaround, additional reproduction steps,
or discover that a newer release resolves it. Some inactive issues are marked
stale and later closed automatically; reply to the stale notice if the issue is
still relevant.
