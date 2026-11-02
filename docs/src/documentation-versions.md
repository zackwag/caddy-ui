# Documentation versions

Use the version selector beside **MIT License** at the bottom of the sidebar to
choose the book for your release. The newest release is listed first, followed
by **Development**, then older releases.
The header identifies the selected version. Some releases share the same book
because their documentation is identical; each release remains selectable.

In caddy/ui, **Documentation** beside the version in the sidebar footer opens
documentation in a new tab for your installed frontend and backend versions.
When they need different books, the documentation site lets you choose the
component. The frontend version is always supplied, using `dev` for local builds.
If the backend version is unavailable, it is omitted rather than assumed to
match the frontend.

**Development** follows ongoing work on `main`. It can describe features that are
not available in a released image. Select it explicitly or open `/dev/` to read
the development book.

The documentation home and unversioned chapter links open the newest release
with an available book. Explicit links to a release or Development keep their
selected version. If no release book is available, the development book stays
readable.

The redirect runs in the browser after the version catalogue loads, so an
unversioned visit can briefly display Development before opening the release
book. If the catalogue cannot load, the current page remains readable.

Switching versions keeps your current chapter when the selected book contains it.
Otherwise, the book opens its home page and explains that the chapter is unavailable.
Search stays within the selected book.

Older releases without a complete book open their GitHub release notes. An
unavailable book never silently opens development documentation as though it
matched your installation.

A newly published release can briefly show release notes in development site
updates while its documentation snapshot is being collected. The release-driven
publication waits for collection before updating the site. A historical book
whose rendering failed retains an explicit release-notes fallback.

Frontend and backend images can have different versions. When an integration link
supplies both and they require different documentation, the documentation site
offers a separate choice for each component. Edge and beta builds use development
documentation.
