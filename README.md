# Auto Profile Pic

**A Thunderbird add-on that shows a round profile picture next to every message in the list, so you recognise who wrote it before reading the name.**

## What it does

In the message list (cards view), each sender gets the first picture available:

1. **Contact photo** from your address book.
2. **Gravatar**, if the sender has one.
3. **Company logo**, taken from the sender's email domain (skipped for personal providers such as Gmail or Outlook.com).
4. Otherwise, **a coloured initial**.

In Sent and other outgoing folders the picture follows the recipient, like the name on the card. Hover the picture to see which address it belongs to.

**Options:** turn Gravatar and company logos on or off, edit the list of personal email domains, clear the picture cache.

## Privacy

Nothing is sent anywhere until you allow it on the consent page shown after installing. With your consent the add-on sends:

- a **SHA-256 hash** of the sender's email address to Gravatar;
- the **domain name** (e.g. `company.com`) to Google, or DuckDuckGo as a fallback, to get the company logo.

No message content, names or plain email addresses are sent. Pictures are cached locally for up to 30 days. Without consent only address book photos and initials are shown.

## Install

1. Download the latest `.xpi` from [Releases](../../releases/latest).
2. Thunderbird → Tools → Add-ons and Themes → ⚙ → *Install Add-on From File…*

Compatible with Thunderbird 128 – 157. It uses an Experiment API (no built-in API can change the message list), so it is distributed here and not on addons.thunderbird.net, and it may need an update when Thunderbird changes its message list.

Thunderbird only installs unsigned add-ons permanently if `xpinstall.signatures.required` can be set to `false` (ESR/Beta/Daily). Otherwise use *Debug Add-ons → Load Temporary Add-on*.

## Releasing

Bump `version` in `manifest.json`, commit, then `git tag vX.Y.Z && git push --tags`. The GitHub Action builds the XPI and publishes the release. Local build: `./build.ps1`.

## License

[MIT](LICENSE)
