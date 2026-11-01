# Backend API

- [ ] [API-001] `[code]` Export endpoint for orders
  Done when: `GET /export` answers 200 with a CSV of the last 30 days
- [ ] [API-002] `[code]` Do-not-contact flag on customers
  Depends on: `API-001`
  Done when: the flag is stored and the newsletter job skips flagged customers
