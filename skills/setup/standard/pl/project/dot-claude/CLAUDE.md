# {{PROJEKT}}

{{OPIS}}

@org-rules/README.md
@org-rules/10-projekt.md

## Co gdzie leży

<!-- Mapa repo: katalog → co w nim jest → reguła obszaru albo strona wiki. Krótko; szczegóły w .claude/rules/ i docs/. -->
| Gdzie | Co | Więcej |
|---|---|---|
| `.claude/org-rules/` | zasady niepodważalne | `README.md` |
| `.claude/rules/` | reguły obszarów (ładują się przy pracy nad pasującymi plikami) | nagłówek `paths:` |
| `docs/` | wiki: jak to działa i dlaczego | `docs/README.md` |
| `docs/decyzje.md` | decyzje czekające na Właściciela | `/decyzje` |
| `.claude/handoffs/` | wątki pracy między sesjami | `/handoff`, `/wznow` |
{{MAPA}}

## Narzędzia standardu

- `python3 tools/docs/check_docs.py` – spójność wiedzy i org-rules (hook po edycji `.claude/` i `docs/` uruchamia go sam).
- `python3 tools/docs/check_docs.py --hints` – przebudowa wskazówek katalogów z `paths:` reguł.
- `sh tools/docs/lock_org_rules.sh --status` – stan ochrony org-rules.
