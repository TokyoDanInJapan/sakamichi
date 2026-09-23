# Security

## Report a problem

Use **[Report a vulnerability](https://github.com/TokyoDanInJapan/sakamichi/security/advisories/new)**
on the Security tab. The report is private. Only you and the maintainer can
see it, so the problem can be fixed before it is public.

If you cannot use that page, open an issue that asks for a private channel.
Do not put the details in the issue, because issues are public.

You will get a reply within a week. One person maintains this site, so a fix
can take longer. You will get an update either way.

## Supported versions

Only the current `main` branch, which is the deployed site, gets fixes.

## Attack surface

The site is two static pages with no server code, no accounts and no cookies.
The build has no dependencies. Each page reads three things:

- `beers.json` and the label images in `beers/`, from the same site
- the settings that it saved in `localStorage`
- the URL, for deep links such as `?theme=dark` and `#contact`

Please report these problems:

- **A crafted URL or saved setting that runs script** or changes the page
  outside the glass and the cards.
- **A crafted URL or saved setting that hangs or crashes the tab.**
- **A link that opens a site other than the one it names.**

The contact form belongs to the brewery's own site. Report problems with it
to the brewery, not here.
