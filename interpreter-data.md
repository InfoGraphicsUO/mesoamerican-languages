`data/interpreters.json` is the public snapshot used by the interpreter directory. Refresh it after updating the private source workbook by installing `openpyxl` from `requirements-export.txt` and running:

```sh
python3 scripts/export-interpreters.py
```

The source workbook, `data/AttestedLanguages_InterpretativeServices.xlsx`, isn't public. The exporter reads provider details and explicit language links, validates the output, and writes only public fields for providers with a linked language to the JSON snapshot.