<p align="center">
  <img src="assets/NFDIxCS_Logo2024_deepblue.png" alt="NFDIxCS Logo" width="360">
</p>

<h1 align="center"><a href="https://samyateia.github.io/ZotExtract/" style="color:inherit;text-decoration:none;">ZotExtract</a></h1>

<p align="center">
  <strong>A Zotero plugin for LLM-based information extraction</strong><br>
  Automatically pull structured metadata and key concepts from full-text PDFs.
</p>

<p align="center">
  <a href="https://github.com/SamyAteia/ZotExtract/releases"><img src="https://img.shields.io/github/v/release/SamyAteia/ZotExtract?style=flat-square" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-CC--BY--4.0-blue?style=flat-square" alt="License"></a>
  <a href="https://www.zotero.org/"><img src="https://img.shields.io/badge/Zotero-7-red?style=flat-square" alt="Zotero 7"></a>
</p>

---

## About

**ZotExtract** is a [Zotero 7](https://www.zotero.org/) plugin that lets you query large language models (LLMs) about the PDFs in your library. Run privacy-focused **local LLMs** on your own device or connect to **online providers** — making it easy to organise your research and combat information overload.

ZotExtract is developed at the [Chair of Information Science](https://www.uni-regensburg.de/sprache-literatur-kultur/informationswissenschaft/), University of Regensburg, within the **[NFDIxCS](https://nfdixcs.org/)** project — the *National Research Data Infrastructure for and with Computer Science* — which promotes FAIR data principles for computer-science research data and software artefacts.

## Features

- **Right-click → ZotExtract** on any Zotero item(s) with PDF attachments
- Batch-process multiple items at once with a progress indicator
- Use the built-in **Prompt Library** or type a custom question
- Two context modes per prompt:
  - **Full text** — sends extracted text from the PDF
  - **Send PDF file** — posts the raw PDF to a file-capable endpoint
- Results are saved as **child notes** on the item
- Fully configurable model provider (OpenAI, Ollama, any OpenAI-compatible API)
- All settings and API keys are stored **locally** in your Zotero profile

## Installation

1. Download the latest `.xpi` file from the [Releases](https://github.com/SamyAteia/ZotExtract/releases) page.
2. In Zotero 7, go to **Tools → Add-ons**.
3. Click the gear icon ⚙️ → **Install Add-on From File…** and select the downloaded `.xpi`.
4. Restart Zotero when prompted.

## Configuration

Open **Edit → Settings → ZotExtract** (or **Zotero → Settings** on macOS) to configure:

| Setting | Description |
|---|---|
| **Provider name** | A label for your LLM provider (e.g. "OpenAI", "Ollama") |
| **Model** | Any OpenAI-compatible model ID (e.g. `gpt-4o-mini`, `llama3`) |
| **API base URL** | The base URL of the API (default: `https://api.openai.com/v1`) |
| **API key** | Your API key — stored only in your local Zotero profile |
| **PDF endpoint** | *(Optional)* URL for a file-upload endpoint when using "Send PDF file" prompts |
| **System prompt** | *(Optional)* Prepended to every request |

### Using a local LLM (e.g. Ollama)

Set the **API base URL** to your local server, for example:

```
http://localhost:11434/v1
```

Leave the API key empty if your local server doesn't require one.

## Usage

1. Select one or more items in your Zotero library.
2. Right-click → **ZotExtract**.
3. Pick a saved prompt or choose **Custom question…** to type your own.
4. A progress bar appears while items are processed.
5. Results are saved as child notes under each item.

### Default Prompts

| Prompt | Context | Description |
|---|---|---|
| Concise summary | Full text | 5 bullet points: goal, methods, results, conclusions |
| Methods + data | Full text | Methodology, datasets, evaluation metrics |
| Limitations | Full text | Potential limitations and assumptions |
| Figure/appendix scan | PDF file | Summarise key numbers, tables, and figures |

You can add, edit, or delete prompts in the **Prompt Library** section of the settings.

## Building from Source

### Prerequisites

- [Zotero 7](https://www.zotero.org/support/beta) installed
- `zip` (Linux/macOS) or PowerShell (Windows)

### Build

**Linux / macOS:**

```bash
chmod +x build.sh
./build.sh
```

**Windows:**

```cmd
build.cmd
```

This produces `zotextract.xpi`.

## Project Structure

```
├── bootstrap.js              # Plugin lifecycle (install, startup, shutdown)
├── chrome.manifest           # Chrome registration
├── manifest.json             # Zotero add-on manifest
├── content/
│   ├── zotextract.js         # Main plugin logic
│   ├── preferences.js        # Settings panel logic
│   └── preferences.xhtml     # Settings panel UI
├── locale/
│   └── en-US/                # Localisation strings
├── assets/                   # Logos and branding
└── build.sh / build.cmd      # Build scripts
```

## Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md) before submitting a pull request.

## Funding & Acknowledgements

<p align="center">
  <a href="https://nfdixcs.org/">
    <img src="assets/NFDIxCS_Logo2024_deepblue.png" alt="NFDIxCS Logo" width="280">
  </a>
</p>

ZotExtract is developed at the **[Chair of Information Science](https://www.uni-regensburg.de/sprache-literatur-kultur/informationswissenschaft/)**, [University of Regensburg](https://www.uni-regensburg.de/), as part of the **[NFDIxCS](https://nfdixcs.org/)** project — the *National Research Data Infrastructure for and with Computer Science* (NFDI×CS). NFDIxCS promotes the implementation of FAIR Data Principles for computer-science research data and software artefacts.

**NFDIxCS** is funded by the [German Research Foundation (DFG)](https://www.dfg.de/) under the [National Research Data Infrastructure (NFDI)](https://www.nfdi.de/) programme.

- **Main contact:** [Samy Ateia](mailto:Samy.Ateia@sprachlit.uni-regensburg.de) — University of Regensburg
- **Website:** [nfdixcs.org](https://nfdixcs.org/)
- **Mastodon:** [@nfdixcs@nfdi.social](https://nfdi.social/@nfdixcs)
- **Bluesky:** [@nfdixcs.bsky.social](https://bsky.app/profile/nfdixcs.bsky.social)
- **LinkedIn:** [NFDIxCS](https://www.linkedin.com/company/106086471)

NFDIxCS is operated by the [Gesellschaft für Informatik e.V. (GI)](https://gi.de/) with the consortium led by the University of Duisburg-Essen.

## License

This project is licensed under the [Creative Commons Attribution 4.0 International License (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).

See the [LICENSE](LICENSE) file for details.
