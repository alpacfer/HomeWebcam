# 0009. Picture captures are written by the localhost server

## Context

The visitor should be able to take a picture without a browser download prompt.
The app is intentionally a browser UI, which cannot write an arbitrary folder without asking for a
permission handle. The station already runs its own Vite server on `127.0.0.1` through `start.sh`.

Pictures are personal data. They must stay on the station and must never become public assets or be
sent to an external service.

## Decision

The browser encodes the full native camera frame as a mirrored, lossless PNG and posts it to a
same-origin `/api/captures` endpoint. A small Vite middleware accepts only PNG bodies, chooses the filename
itself, and writes the image into the gitignored `captures/` directory.

The saved image contains only the camera frame. Menus, countdown text, the cursor, and the debug
overlay are presentation layers and are not burned into it.

## Consequences

Capture is automatic and remains local. The endpoint is available in both the development and
preview servers, but is bound to the same localhost-only server as the rest of the station.

Running a fully static build without that server can display the interface but cannot save photos.
If the deployment stops using Vite, its replacement must implement the same local endpoint or an
equivalent local storage mechanism.
