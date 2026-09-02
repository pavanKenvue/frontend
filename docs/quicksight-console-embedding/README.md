# Enabling QuickSight Console (author-mode) embedding

This app currently embeds the dashboard read-only, via the Embedding SDK's
`embedDashboard()` (see [`src/components/DashboardEmbed.jsx`](../../src/components/DashboardEmbed.jsx)).
The toolbar in the screenshot below — Undo/Redo, "Save as", the "Create"
menu — is a different thing entirely: it's QuickSight's full **authoring
console** (the same UI you get logging into `quicksight.aws.amazon.com`
directly and opening an analysis), embedded via `embedConsole()`.

Getting that toolbar means embedding the console experience instead of the
dashboard experience. That's not a toggle on the existing embed — it needs
changes on both the AWS/QuickSight side and the backend that hands out
embed URLs. This doc covers the AWS/QuickSight side; the companion
[`backend/console-embed-service`](../../backend/console-embed-service) folder
is a new, narrowly-scoped FastAPI service for the URL-generation half.

## 1. The embedded QuickSight user needs Author permissions

Every embed URL is minted for a specific QuickSight user (the
`QUICKSIGHT_USER_ARN` this app's backend already uses for the read-only
dashboard). That user's **role** determines what they can do once inside:

- **READER** (what this app uses today) — can view dashboards and apply
  filters/controls, nothing else. A Console embed URL generated for a
  Reader will not grant authoring capability — QuickSight enforces the
  role regardless of which experience you embed.
- **AUTHOR** (or **ADMIN**) — required for the Console experience to be
  useful at all: build/edit visuals, edit analyses, and — the specific
  button in the screenshot — **Save as**, which duplicates the current
  analysis under a new name.

Change this either in the QuickSight console (**People** → find the user →
**Edit role** → Author) or via the AWS CLI/SDK:

```bash
aws quicksight update-user \
  --aws-account-id <ACCOUNT_ID> \
  --namespace default \
  --user-name <the QuickSight username behind QUICKSIGHT_USER_ARN> \
  --role AUTHOR \
  --email <user-email>
```

**Consider a separate QuickSight user/namespace for this**, rather than
upgrading the existing Reader user in place. The Reader user is presumably
shared across every viewer of this app (a single service-account-style
ARN) — promoting it to Author would hand *every* viewer of the dashboard
editing rights, not just whoever you intend to let into the console. A
second, distinct user (and ideally its own `QUICKSIGHT_USER_ARN` gated
behind a separate app route or role check) keeps the blast radius to
whoever is actually meant to get it.

## 2. IAM permission for the backend's AWS credentials

Whatever IAM role/user the backend runs as (Lambda execution role, EC2
instance profile, etc.) needs `quicksight:GenerateEmbedUrlForRegisteredUser`
— the same action already used for the Dashboard embed URL, since both
experience types go through the same API call, just with a different
`ExperienceConfiguration`. If the existing policy already scopes this
action to the Reader user's ARN only, widen the resource to also cover
whichever user/ARN you set up in step 1.

```json
{
  "Effect": "Allow",
  "Action": "quicksight:GenerateEmbedUrlForRegisteredUser",
  "Resource": "arn:aws:quicksight:<region>:<account-id>:user/default/<console-user-name>"
}
```

## 3. Allowed embedding domains

QuickSight only lets an embed URL be framed by domains it's been told to
trust. Add this app's origin(s) under **Manage QuickSight** → **Domains and
Embedding** in the QuickSight console, or pass `AllowedDomains` on the
`GenerateEmbedUrlForRegisteredUser` call itself (the FastAPI service in
this repo does the latter, driven by an `ALLOWED_DOMAIN` env var — matching
the naming this app's existing backend already uses per its `.env.example`).

## 4. What "Save as" actually does, and why that matters here

"Save as" duplicates the **analysis** currently open in the console into a
new one, owned by whoever's embedded session it is. It does not modify the
original `SHIPMENT` analysis/dashboard — but it does create new QuickSight
objects (an analysis, and whatever datasets it references stay shared)
under that user's account. If the intent is "let people fork a copy to
experiment," that's exactly what this does. If the intent was something
narrower — just re-arranging filters without creating new artifacts — the
existing read-only dashboard + this app's own Filter Builder already covers
that, and Console embedding may be more capability than needed.

## 5. Session/other considerations

- **Row-level security** (if configured on the underlying datasets) still
  applies to whichever QuickSight user the embed URL is generated for —
  Author does not bypass RLS.
- `SessionLifetimeInMinutes` on the embed URL call caps how long the
  console session stays valid before needing a fresh URL (the FastAPI
  service defaults this to 100, QuickSight's own default).
- The Console experience is **registered-user only** — there is no
  anonymous-user equivalent (unlike Dashboard/Visual embeds, which support
  `GenerateEmbedUrlForAnonymousUser` for viewers without individual
  QuickSight accounts). Every console session is tied to a real,
  role-having QuickSight user.

## Summary checklist

- [ ] Decide: promote the existing Reader user, or provision a separate
      Author user for this
- [ ] `quicksight update-user --role AUTHOR` (or ADMIN) for that user
- [ ] Confirm the backend's IAM role can `GenerateEmbedUrlForRegisteredUser`
      for that user's ARN
- [ ] Add this app's domain(s) to QuickSight's allowed embedding domains
- [ ] Decide who in the app should actually see the "open in console" entry
      point (this is an authoring surface, not something to expose to every
      viewer by default)
