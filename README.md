<p align="center">
  <img src="assets/NFDIxCS_Logo2024_deepblue.png" alt="NFDIxCS Logo" width="360">
</p>

<h1 align="center"><a href="https://samyateia.github.io/ZotExtract/" style="color:inherit;text-decoration:none;">ZotExtract</a></h1>

<p align="center">
  <strong>A Zotero plugin for LLM-based information extraction</strong><br>
  Pull useful paper details and key ideas from full-text PDFs.
</p>

<p align="center">
  <a href="https://github.com/SamyAteia/ZotExtract/releases"><img src="https://img.shields.io/github/v/release/SamyAteia/ZotExtract?style=flat-square" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License"></a>
  <a href="https://www.zotero.org/"><img src="https://img.shields.io/badge/Zotero-7--9-red?style=flat-square" alt="Zotero 7-9"></a>
</p>

---

## About

**ZotExtract** is a [Zotero](https://www.zotero.org/) plugin for Zotero 7, 8, and 9. It helps you ask the same questions across selected papers, review the answers in Zotero, and export the results. You can use **local LLMs** on your own device or connect to **online providers**.

ZotExtract is developed at the [Chair of Information Science](https://www.uni-regensburg.de/sprache-literatur-kultur/informationswissenschaft/), University of Regensburg, within the **[NFDIxCS](https://nfdixcs.org/)** project, the *National Research Data Infrastructure for and with Computer Science*.

## Why ZotExtract

ZotExtract is built for researchers who want LLM help without leaving Zotero. It keeps each answer tied to the papers you selected, can show the cited lines behind an answer, and exports compact result files for spreadsheets or scripts.

## Features

- Start a ZotExtract session from selected papers or a collection.
- Add more papers to an existing draft session.
- Pick built-in or custom questions in the **Add extractions** view.
- Compare answers across papers in the **ZotExtract Sessions** tab.
- Use Zotero title, abstract, item details, and indexed PDF text when available.
- Review cited lines and open the related PDF location when Zotero can provide it.
- Export completed sessions as XLSX, CSV, TSV, JSON, Markdown, or HTML.
- Configure OpenAI, OpenRouter, Google Gemini, Ollama, LM Studio, llama.cpp, Jan, or another OpenAI-compatible API.
- Keep settings and API keys **local** in your Zotero profile.

## Installation

1. Download the latest `.xpi` file from the [Releases](https://github.com/SamyAteia/ZotExtract/releases) page.
2. In Zotero, go to **Tools → Add-ons**.
3. Click the gear icon ⚙️ → **Install Add-on From File…** and select the downloaded `.xpi`.
4. Restart Zotero when prompted.

## Configuration

Open **Edit → Settings → ZotExtract** (or **Zotero → Settings** on macOS) to configure:

After installation, ZotExtract points you to this Settings pane before you run your first session.

| Setting | Description |
|---|---|
| **Discover local servers** | Finds common local Ollama, LM Studio, llama.cpp, and Jan servers |
| **Provider name** | A label for your LLM provider (e.g. "OpenAI", "Ollama") |
| **Model** | Any OpenAI-compatible model ID supported by your configured provider |
| **Advanced provider configuration** | API URL, API key, timeout, context size, request limit, full-text cap, and prompt templates |

The settings pane also links to the official [LM Studio download page](https://lmstudio.ai/download) for users who want a local desktop model server.

Advanced settings include editable prompt templates. Most users can keep the defaults.

### Using a local LLM (e.g. Ollama)

Set the **API base URL** to your local server, for example:

```
http://localhost:11434/v1
```

Leave the API key empty if your local server doesn't require one.

## Usage

1. Select one or more Zotero items, or right-click a collection.
2. Choose **Start ZotExtract session...**.
3. In the **ZotExtract Sessions** tab, review the paper table.
4. Click **Add extractions** and choose individual questions or whole question sets.
5. Click **Add to my ZotExtract session**.
6. Run the session. ZotExtract uses Zotero item details and PDF text when available.
7. Review the completed table, open cited PDF locations when available, and export the results.

### Built-In Question Sets

ZotExtract ships with question sets for Overview & Scope, Methods & Data, Results & Evaluation, Limitations & Critique, and Reproducibility. They are designed for comparing the same question across multiple papers.

Question prompts are managed in the **Add extractions** view. The question editor contains **Question**, **Question set**, and **Prompt**.

When possible, answers cite line IDs such as `L000123`. ZotExtract keeps the final answer easy to read and lets you expand the supporting lines when needed.

For long papers, ZotExtract works through the text in smaller parts. Very long text is capped by the full-text limit in Settings, which defaults to 400,000 characters.

## Export

After running a ZotExtract session, open the completed session and choose **Export results**. ZotExtract can write XLSX, CSV, TSV, JSON, Markdown, or HTML files to `zotextract-exports/` in your Zotero profile.

Exports include session details, paper details, questions, answers, CSV rows for spreadsheets, and short cited quotes if the model returned them. They do not include raw PDF full text.

Provider settings include a request timeout so slow endpoints do not block ZotExtract indefinitely.

## Building from Source

### Prerequisites

- [Zotero 7, 8, or 9](https://www.zotero.org/) installed
- An archive tool for builds: `zip`, Python 3, bsdtar, or PowerShell

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

This project is licensed under the [MIT License](LICENSE).

See the [LICENSE](LICENSE) file for details.
