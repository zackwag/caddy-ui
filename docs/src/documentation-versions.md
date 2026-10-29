# Documentation versions

Use the version selector beside **MIT License** at the bottom of the sidebar to
choose the book for your release. The newest release is listed first, followed
by **Development**, then older releases.
The header identifies the selected version. Some releases share the same book
because their documentation is identical; each release remains selectable.

**Development** follows ongoing work on `main`. It can describe features that are
not available in a released image. Select it explicitly or open `/dev/` to read
the development book.

The documentation home and unversioned chapter links open the newest release
with an available book. Explicit links to a release or Development keep their
selected version. If no release book is available, the development book stays
readable.

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
