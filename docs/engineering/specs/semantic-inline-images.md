# Semantic inline images

> **Status**: Approved for implementation on 2026-09-05.
> **Audience**: Maintainers who change shared prose, document-image storage, publishing, search, or
> export behavior.
> **Required action**: Keep figure parsing, serialization, reference reconciliation, and public
> authorization on the boundaries defined here.

Docket stores a figure inside the Markdown string that already owns each task, project, initiative,
program, team, milestone, comment, update, or template body. The figure codec accepts existing
Markdown images and one versioned Docket HTML shape. It emits semantic `figure`, `img`, and
`figcaption` elements with Schema.org `ImageObject` properties. It escapes every authored value.
It rejects malformed or unknown HTML, which the Markdown renderer continues to show as text.

The lifecycle component diagram is in
[`diagrams/semantic-inline-image-lifecycle.mmd`](diagrams/semantic-inline-image-lifecycle.mmd). The
editor uploads bytes before it inserts the final figure. Saving prose reconciles derived references.
Deletion and delayed cleanup still parse authoritative prose before they delete a blob. This second
check protects live content when a write subscriber failed after the entity write committed.

## Figure contract

Version 1 carries the image URL, alt text, decorative state, caption, credit text, source URL,
license text, and license URL. Caption and attribution fields are optional. A decorative figure has
an empty `alt` value. A non-decorative upload starts with alt text derived from its original
filename. Each figure use owns its caption and attribution. The image blob continues to own its
workspace, uploader, original filename, MIME type, byte size, and creation time.

`contentUrl`, `caption`, `creditText`, and `license` use the matching Schema.org `ImageObject`
properties. A linked license also carries `rel="license"`. Credit text uses ordinary phrasing
content. It does not use `cite`, since HTML reserves that element for the title of a work.

The codec accepts only safe application-relative image routes and HTTPS URLs. It accepts only HTTPS
source and license links. Existing `![alt](src)` images keep their current representation until an
author edits and saves that image. Docket does not accept arbitrary HTML or add a remote-image
insertion control.

## Editor behavior

An `Insert` control appears beside an empty paragraph. It opens the same block menu that `/` opens.
The Image action opens a labeled multi-file picker and preserves selection order. Browsing, pasting,
dropping, retrying, and replacing all pass through one upload controller. A pending upload occupies
its intended document position. It announces progress politely. A failed upload exposes retry and
remove actions and uses an alert without changing persisted prose.

The caption remains directly editable below the image. A Details panel edits alt text, the
decorative state, credit, source, license text, and license URL. A selected figure toolbar exposes
Replace and Details. Narrow widths move lower-priority actions into an overflow menu. The toolbar
never wraps. `Alt+F10` focuses it, and Escape returns focus to the figure. All pointer actions have
keyboard equivalents and visible focus styles. File-drop handling ignores internal editor moves and
drags without files.

Images use their natural aspect ratio and stay within the prose column. This release does not crop,
resize, or derive new image files.

## Reference projection and cleanup

`document_image_reference` is a derived table keyed by image and prose subject. It covers task,
project, program, initiative, team, milestone, comment, update, and template. Template reconciliation
reads the description in its typed payload. Each successful saved write reconciles the complete
reference set for that subject.

The delete route returns the stable `image_in_use` conflict when authoritative saved prose still
references an image. A daily job considers uploads after seven unreferenced days. Before it removes
bytes, it parses all authoritative prose in the workspace. When it finds a live use that the derived
table missed, it repairs the projection and retains the image. A blob deletion failure retains the
database row so a later cleanup can retry.

Source URLs enter the existing Library reference projection. License URLs remain figure metadata.
Plain-text projections include alt text, caption, credit, and license text. Rendered projections
preserve the full figure semantics. These rules apply to search, excerpts, AI context, print,
clipboard conversion, MCP reads, templates, and exports.

## Public briefs

Public image routes sit beside the existing public-brief routes. Each anonymous request resolves the
current live publication and verifies that its current description references the requested image.
The response uses `Cache-Control: no-store`. Removing the figure, withdrawing the brief, changing
its slug, or moving it across workspaces revokes the prior URL on the next request.

The public brief uses the server-safe Markdown renderer. That renderer emits semantic figures and
rewrites private image sources to the matching shared-host or custom-domain public route. The
publish dialog states that inline images and their attribution become public.

## Rejected scope

SVG is excluded because it is executable XML and needs a separate sanitizer or rasterization
boundary. Direct SVG support would otherwise allow scripts, external resources, CSS, and embedded
HTML to enter a same-origin upload route. Remote URL fetching is excluded because it creates an SSRF
and privacy boundary. Cropping, resizing, EXIF/IPTC extraction, and generated derivatives are also
excluded because none is required to preserve semantic figures.

The decision should change when Docket has a maintained SVG sanitizer with a narrow element and
attribute allowlist, or when the upload service can rasterize SVG in an isolated process. It should
also change if product requirements call for responsive derivatives or focal-point cropping.

## Validation

Codec tests must cover exact round trips, Markdown-image compatibility, optional fields, decorative
figures, escaping, unsafe schemes, malformed HTML, and unsupported HTML. API and database tests must
cover upload validation, tenancy, all nine subject types, template payloads, replacement, projection
repair, delayed cleanup, and blob failures. Public tests must cover logged-out reads, live edits,
removal, slug changes, custom domains, cross-workspace denial, and withdrawal.

Editor tests must cover browse, paste, drop, multiple files, retry, replace, undo, caption and
attribution editing, slash-menu parity, keyboard toolbar access, focus return, live regions, and
phone overflow. The release check uses a task for the full browser journey and parity tests for each
other editor host. The standard screenshot set is 1440 by 900 and 390 by 844 in light and dark
themes. The logged-out public brief also receives a browser check. The seeded database is reset after
the visual pass.
