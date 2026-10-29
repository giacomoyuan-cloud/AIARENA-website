# OpenAI server transport

This standalone Node 22 service forwards the assistant's Astra and Sol requests to the official OpenAI Responses API. It is prepared for a separate Railway service; it does not change comm-hub or its credentials.

- The original OpenAI key stays in Cloudflare's encrypted secret. Railway stores only its SHA-256 fingerprint in `OPENAI_ALLOWED_KEY_SHA256`.
- Each authenticated request sends the existing key and conversation to Railway over HTTPS, then to OpenAI. The application does not persist or log either value.
- Only the pinned key is accepted. Only Astra and Sol Responses requests and an authenticated model-list check are allowed. Redirects, image generation routes, and the image-generation tool are rejected.
- Streams are forwarded immediately. Client cancellation aborts the upstream request. OpenAI errors and request IDs are preserved; there is no automatic provider or billing fallback.

Run checks with `npm test` in this directory. For deployment, use an independent service with this directory as its root, the Dockerfile build, `/healthz` as its health check, and an American deployment region. Railway hosting consumes the existing account's compute and network allowance and may add usage charges.

After user authorization and a successful model-list check, configure the assistant Worker's `OPENAI_RELAY_ORIGIN` to the service's HTTPS `*.up.railway.app` origin. Verify both models with synthetic incognito conversations before enabling normal use.
