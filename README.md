# MimirOCR

MimirOCR is a desktop application built using Tauri that connects a VueJS frontend to a FastAPI backend written in Python 3.10. MimirOCR leverages machine learning to automate the transcription of printed Dano-Norwegian Fraktur into Modern Antiqua script. Installers have been made for MacOS (ARM) and Windows x86-64 platforms, and can be found under the Releases section of this repository page.

## Note on Code Signing
This is a summer research project through the Nordic Studies Department at Luther College, and in no way is monetized nor intended to be monetized. As a result, I have not been able to pay for the high cost of code signing and notarization. While this may change in the future, this means that both Windows and MacOS will flag any installer for MimirOCR and prompt users to bypass this by entering an administrator passcode. I recognize this is difficult or not possible for many academics working on managed workstations or laptops.

### What is Fraktur?
Fraktur the most modern of the German Gothic Scripts. Of the four (the others being Textura, Rotunda, and Schwabacher), Fraktur is the most modern and stylistic, being used from the 16th to 20th centuries. While the script was most often used for German texts, many other European languages had texts or books published in Fraktur, whether due to popularity or printing press conventions. This was an easy migration for many Germanic languages due to the similar alphabet shared between many of them. One of these langauges to have many texts printed in Fraktur was early Norwegian, dubbed Dano-Norwegian. Towards the end of the 19th century, the use of Fraktur was starting to decline in favor of Antiqua scripts, the same script we use today. From then on, less and less text was printed in Fraktur, mostly fizzling out around the end of World War II due association with German Nationalism. 

### What is Dano-Norwegian?
Dano-Norwegian is a broad linguistic classification referring to written Norwegian that developed from written Danish after the union between Denmark and Norway ended in 1814. This is due to the majority of educated Norwegians in the 19th century having recieved their educations in Denmark. Dano-Norwegian became the root for modern Bokmål, Norway’s most widely used written language today.

### Significance
Many Norwegian Americans who emigrated in the 19th century continued to read and write in Norwegian, specifically Dano-Norwegian. Whether due to the printing conventions at the time or a need for cultural preservation through typeface, many of these texts were printed in Fraktur. The script is not impossible to read normally, but is difficult enough that it is often not worth attempting to learn how to directly read Fraktur. Hand transcription of Fraktur, though effective, takes time and effort that students, professors, or interested individuals could likely invest in more productive efforts. The automation of the transcription of Dano-Norwegian Fraktur allows for these texts to be read and distributed without investing hours into hand transcriptions of the text and makes them accessible to those who don't speak Norwegian or Danish through external translation tools like Google Translate or DeepL.

### Tooling and Technical Specifications
MimirOCR uses a combination of two major OCR libraries to perform transcription. The Optical Character Recognition (OCR) is performed by a model trained using [Calamari-OCR](https://github.com/Calamari-OCR/calamari). The training process was completed by combining one of Calamari's 19th century Fraktur models and training data collected from hand transcribed Dano-Norwegian Fraktur texts owned by Preus Library at Luther College. This approach is possible because of Calamari-OCR's warmstart training feature, which made it possible to use their 19th century Fraktur model as a springboard to go from general Fraktur transcription to Dano-Norwegian Fraktur transcription by providing samples of Dano-Norwegian specific characters and language conventions. 

In order to obtain images of the lines of text within input PDFs, page layout information, and other relevant data, MimirOCR makes use of [Kraken](https://github.com/mittagessen/kraken), which has been specifically developed to facilitate OCR on historical texts. These two models run in separate bundled worker processes, coordinated by a localhost FastAPI sidecar in the Tauri app. This means that transcription occurs locally. This was an intentional design decision, as hosting the backend on a performant enough server would cost more money than is feasible as a Student Researcher.

## Development and packaging

Use Python 3.10 (CI: 3.10.11) to create the API, Kraken 7.1.1, and Calamari environments:

```sh
python scripts/setup_backend.py --dev
yarn install --frozen-lockfile
yarn tauri:dev:auto
```

`yarn build:sidecar` builds three independent PyInstaller onedir runtimes and
smoke-tests real inference. `yarn package:mac` / `yarn package:windows` include
all three in one desktop app. See [runtime setup and architecture](docs/architecture/ocr-process-split.md)
for interpreter selection, packaging, deadlines and dependency management.

For the backend package layout and where to make changes, see
[backend code organization](docs/architecture/backend-organization.md).
For frontend feature ownership, shared helpers, and review geometry, see
[frontend code organization](docs/architecture/frontend-organization.md).

## Testing

Unit and component tests run on pull requests and gate tagged release builds.
See [the testing guide](docs/testing.md) for coverage, isolation, CI behavior, and
guidelines for adding tests. See [testing architecture diagrams](docs/testing-architecture.md)
for a visual map of test flows.

- Python backend: `pytest`, `pytest-cov`, `fastapi.testclient`
- Vue frontend: `vitest`, `@vue/test-utils`
- Rust/Tauri side: built-in `cargo test`

### Run backend tests

Install backend test dependencies:

```bash
python -m pip install -r requirements-test.txt
```

Run tests:

```bash
pytest
pytest --cov=backend --cov-report=term-missing
```

### Run frontend tests

Install dependencies:

```bash
yarn install --frozen-lockfile
```

Run tests:

```bash
yarn test:unit
yarn test:unit:coverage
```

### Run Rust/Tauri tests

```bash
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib
```

## Documentation

Contributor documentation lives under `docs/` and is published via MkDocs. It is also published to [Github Pages](https://mrogness.github.io/MimirOCR/) for ease of viewing.

- Entry point: [docs/index.md](docs/index.md)
- Testing architecture diagrams: [docs/testing-architecture.md](docs/testing-architecture.md)
- Automation details: [docs/maintenance/automation.md](docs/maintenance/automation.md)

### Build docs locally

```bash
python -m pip install -r requirements-docs.txt
python scripts/generate_docs.py
mkdocs serve
```

Or via Yarn scripts:

```bash
yarn docs:generate
yarn docs:build
```
