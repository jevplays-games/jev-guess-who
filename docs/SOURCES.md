# Source provenance

## User-provided basis

`source/original-requirements.md` is the uploaded **JEV Single-Page Game — Architecture & Implementation Planning Prompt**. It supplies the vanilla single-page philosophy, structured legal-action JEV boundary, Discord identity/community scopes, backend trust model, verified rankings, replay/testing requirements, and required A–Z organization.

The prior Guess Who design in the conversation supplies the selected 24-character rules, separate question/final-guess turns, independent secrets, 12 predicates, four difficulties, server projections, Wilson ranking, and minimal deployment direction.

The request to “have exhaustive analytics, create this and zip it up” authorizes the implementation and analytics additions. Additions and unimplemented release responsibilities are called out in the engineering, analytics and security documents rather than silently attributed to the original prompt.

## Primary technical references checked on 2026-09-22

- TypeSafe HTTP request/response contract: https://docs.typesafe.ai/api
- TypeSafe Choice options, probability map and confidence: https://docs.typesafe.ai/primitives/choice
- TypeSafe versioned models and alias behavior: https://docs.typesafe.ai/models
- Discord OAuth scopes, authorization-code exchange and state: https://docs.discord.com/developers/topics/oauth2
- Discord interaction payloads and responses: https://docs.discord.com/developers/interactions/receiving-and-responding
- Cloudflare Workers static assets: https://developers.cloudflare.com/workers/static-assets/
- Node built-in SQLite documentation: https://nodejs.org/api/sqlite.html

These references support integration shapes, not a claim that authenticated requests or a cloud deployment were executed. API behavior can change. The delivered adapter pins a versioned model and validates exact response contracts; staging tests remain required.

The underlying game name is used descriptively. Original portraits, character names and UI are supplied; no commercial character sheet is reproduced. This package does not provide a legal opinion about publishing or marketing a product name.
