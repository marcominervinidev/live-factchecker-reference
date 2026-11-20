# 0012: Verträge in Zod, JSON Schema daraus erzeugt

Verträge unter `packages/contracts` werden in **Zod** (TypeScript, Paket `zod` 4.6.7, exakt gepinnt) geschrieben; das ist ihre einzige Quelle. Aus jedem Schema erzeugt `packages/contracts/scripts/generate-json-schema.ts` mit dem eingebauten Export `z.toJSONSchema` ein **JSON Schema** (Draft 2020-12) als Artefakt unter `packages/contracts/json-schema/<name>.schema.json`. Das Artefakt schreibt nie jemand von Hand; es wird mit dem Schema im selben Commit eingecheckt, und der Vertragstest `src/json-schema.test.ts` wird rot, sobald es vom Zod-Stand abweicht oder ein Artefakt ohne Schema dort liegt. Der Python-Harness unter `evals/` liest nur dieses Artefakt und teilt keinen Code mit den Diensten. Jedes Schema trägt das Versionsfeld `schemaVersion: z.literal(N)`, beginnt bei 1 und steigt bei jeder Änderung; `scripts/check-contract-change.sh` erkennt die Version an genau diesem Muster. Marco hat das am 2026-10-28 entschieden.

Status: accepted. Quelle: Issue #27 (T2), Kommentar "Entscheidung Marco (2026-10-28): Vertragsformat", angestoßen vom Architektur-Review von #40 (2026-10-28), das vor dem ersten Vertrag eine Entscheidung zu Bibliothek, Export nach JSON Schema und Versionsfeld verlangte. Regeln: `.claude/rules/contracts.md`, Skill `new-contract`. Erster Vertrag: `Segment` (ADR 0005, Nachtrag 2026-10-29).

## Considered Options

- **Zod als Quelle, JSON Schema erzeugt:** gewählt. Typ, Laufzeitprüfung und Regeln über mehrere Felder (`.refine` mit Pfad) stehen an einer Stelle; der Harness bekommt eine sprachneutrale Form, ohne Node aufzurufen.
- **JSON Schema als Quelle, Typen und Prüfung daraus erzeugt:** Regeln über mehrere Felder (beim Segment: `start` gleich dem Start des ersten Worts, Wortreihenfolge, `finalizedAt` nicht vor `end`) hat Standard-JSON-Schema nicht; sie stünden dann doch in TypeScript neben dem Schema. Verworfen.
- **Zod und JSON Schema beide von Hand:** zwei Quellen laufen auseinander, ohne dass ein Test es merkt. Verworfen.
- **Gemeinsamer Prüfcode für Dienste und Harness** (der Harness ruft Node auf): bricht die Regel, dass `evals/` nur Python-Standardbibliothek nutzt, und koppelt den Harness an den Build der Dienste. Verworfen.

## Consequences

- Das Artefakt trägt Typen, Muster, Grenzen, Pflichtfelder und geschlossene Objekte. Regeln über mehrere Felder kennt nur Zod; wer nur das Artefakt liest, prüft sie selbst oder verlässt sich auf den Input. Die README von `packages/contracts` nennt sie je Schema.
- Zod meldet unbekannte Felder eines strikten Objekts in einer einzigen Meldung ohne Pfad; der Baustein `unknownFieldsNamed` in `src/common.ts` ergänzt eine Meldung je Feld, damit jede Abweisung ihr Feld nennt. Jedes strikte Objekt eines Vertrags trägt ihn.
- Der Generator liegt unter `scripts/`, nicht unter `src/`, damit die Vertragsprüfung ihn nicht als Schema zählt; das Artefakt liegt im Paket und darf deshalb im Vertrags-Commit mitkommen. Welche Schemas ein Artefakt bekommen, folgt aus den Exporten von `src/index.ts`. Prettier formatiert `json-schema/` nicht; seine Bytes sind die des Generators.
- **Restrisiko:** Generator und Artefakt liegen außerhalb der Vertragsprüfung. Eine Änderung unter `json-schema/` oder am Generator ohne höhere `schemaVersion` besteht `scripts/check-contract-change.sh`; nur der Frischetest bindet das Artefakt an den Zod-Stand. Ob die Prüfung beides einbezieht, klärt #44.
- Ein Update von `zod`, das die erzeugte Form ändert, zeigt der Test; das neue Artefakt kommt mit dem Update in denselben Pull Request.
- In T2 liest noch niemand das Artefakt; wann der Harness es zuerst liest, legt das Ticket fest, das ihn an die Segment-Naht anschließt.
