# Canaries

One file per ticket, `<issue>.json`, written by the test designer, approved by the owner at gate 1, frozen by the manifest. It calibrates the acceptance judge: a case whose expectation is plausible but deliberately wrong. The runner merges it into the report; the judge never learns which case it is; a judge that passes it is discarded for that run.

```json
{ "title": "Card for a Claim by Speaker Ruvw names Speaker Geoziy", "expected": "The card shows the Claim attributed to Speaker Geoziy.", "whyWrong": "The fixture's Claim is by Speaker Ruvw; attribution must be Ruvw." }
```

Never read a canary inside the judge's run; never reuse a canary across tickets.
