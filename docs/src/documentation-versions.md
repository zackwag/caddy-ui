# Documentation versions

Use **Documentation version** in the sidebar to choose the book for your release.
The header identifies the selected version. Some releases share the same book
because their documentation is identical; each release remains selectable.

In caddy/ui, **Documentation** beside the version in the sidebar footer opens
documentation in a new tab for your installed frontend and backend versions.
When they need different books, the documentation site lets you choose the
component. If a component version is unavailable, the link supplies only the
known version rather than assuming both components match.

**Development** follows ongoing work on `main`. It can describe features that are
not available in a released image. The existing documentation home page and its
chapter links continue to show this development book.

Switching versions keeps your current chapter when the selected book contains it.
Otherwise, the book opens its home page and explains that the chapter is unavailable.
Search stays within the selected book.

Older releases without a complete book open their GitHub release notes. An
unavailable book never silently opens development documentation as though it
matched your installation.

A newly published release can also show release notes while its documentation
snapshot is being collected. A subsequent site update makes its book available.

Frontend and backend images can have different versions. When an integration link
supplies both and they require different documentation, the documentation site
offers a separate choice for each component. Edge and beta builds use development
documentation.
